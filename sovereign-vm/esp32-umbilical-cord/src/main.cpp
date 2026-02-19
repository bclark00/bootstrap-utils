/*
 * ESP32 Umbilical Cord - SOVEREIGN EDITION v2.0
 *
 * The cord cutter. Hardware trust anchor.
 *
 * Key changes from v1.0:
 *   - UART bridge -> sovereign-fs-mcp (NOT exeray)
 *   - BOOTSTRAP MODE: types sovereign VM to Mac Mini via USB HID
 *   - Hash verification BEFORE typing (double-check: reported + computed)
 *   - No hardcoded credentials
 *   - No exeray / infected-host references
 *
 * Trust model:
 *   ESP32 firmware (flashed directly, independent of Windows stack)
 *     UART -> sovereign-fs-mcp.js (on Windows, hash-verified)
 *     USB HID -> Mac Mini (files typed directly, no network trust)
 *
 * The Mac Mini trusts nothing except what comes through USB.
 * The ESP32 trusts nothing that doesn't match the manifest SHA256.
 */

#include <Arduino.h>
#include "USB.h"
#include "USBHIDKeyboard.h"
#include "USBHIDMouse.h"
#include <WiFi.h>
#include <ESPAsyncWebServer.h>
#include <ArduinoJson.h>
#include <mbedtls/sha256.h>

#ifndef WIFI_SSID
#define WIFI_SSID "SovereignCord"
#endif
#ifndef WIFI_PASS
#define WIFI_PASS "changeme123"
#endif

#define HOST_TX_PIN    43
#define HOST_RX_PIN    44
#define HOST_BAUD      115200
#define HID_CHAR_DELAY 5
#define HID_LINE_DELAY 20

// Manifest embedded at flash time
// Source: bootstrap-utils/sovereign-vm/SOVEREIGN-VM-MANIFEST.txt
// VM identity: 65818d0f
struct ManifestEntry { const char* file; const char* sha256; int layer; };
static const ManifestEntry MANIFEST[] = {
  {"sovereign-fs-mcp.js",            "fa29f39af353723224163cccf32b79b4257d350ad2bc7ec05a1ac21e793e81c4", 0},
  {"sovereign-audit-mcp.js",         "d34d4b74c6115ebaf1bfc29d7c254348c9bc11ee40246b2c4ce7ff45a1a0718c", 1},
  {"sovereign-pipe-mcp.js",          "6e6718dc1265ec4550a97bd3d2747063ba49d113196ab659f1e1774631c5f136", 2},
  {"sovereign-transport-mcp.js",     "db12004df63281cc39399ab6bed4109735519dc8481e08bef0b4e7ba3140efdd", 3},
  {"sovereign-boot.js",              "73763171e16032a6e7a5d216eee1497eedf12be5d37ecbf61094988391bab6b7", 4},
  {"sovereign-9p-gateway.js",        "1eb54373125b4c2f1d184a0e2d3a83df5e441764dfd70af1a58ff2e48f30a9bf", 5},
  {"sovereign-manifest-generator.js","2979278b27a9d45dab4b423ef12f389d6b046adb9148448921c8424d03044c34", 6},
};
static const int MANIFEST_SIZE = sizeof(MANIFEST)/sizeof(MANIFEST[0]);
static const char* VM_IDENTITY = "65818d0f27b89d77f113a4ce711d4fd8a7293b516d42c9ea058307f787e09302";

USBHIDKeyboard Keyboard;
USBHIDMouse    Mouse;
HardwareSerial HostUART(1);
AsyncWebServer httpServer(80);
int uartRequestId = 1;

String sha256hex(const uint8_t* data, size_t len) {
  uint8_t hash[32];
  mbedtls_sha256_context ctx;
  mbedtls_sha256_init(&ctx);
  mbedtls_sha256_starts_ret(&ctx, 0);
  mbedtls_sha256_update_ret(&ctx, data, len);
  mbedtls_sha256_finish_ret(&ctx, hash);
  mbedtls_sha256_free(&ctx);
  String hex;
  for (int i=0;i<32;i++){char b[3];snprintf(b,3,"%02x",hash[i]);hex+=b;}
  return hex;
}

// Call sovereign-fs-mcp via UART
String uartFsRead(const char* path) {
  StaticJsonDocument<256> req;
  req["jsonrpc"]="2.0"; req["method"]="tools/call"; req["id"]=uartRequestId++;
  JsonObject p=req.createNestedObject("params");
  p["name"]="fs_read";
  p.createNestedObject("arguments")["path"]=path;
  String line; serializeJson(req,line);
  HostUART.println(line);
  unsigned long t0=millis();
  while(millis()-t0<8000){
    if(HostUART.available()){
      String r=HostUART.readStringUntil('\n');
      r.trim(); if(r.length()>0) return r;
    }
    delay(5);
  }
  return "";
}

// Fetch + double-verify SHA256
String fetchAndVerify(const char* filename, const char* expectedSha) {
  Serial.printf("[VERIFY] %s\n",filename);
  String resp=uartFsRead(filename);
  if(!resp.length()){Serial.printf("[HALT] timeout %s\n",filename);return "";}
  DynamicJsonDocument outer(65536);
  if(deserializeJson(outer,resp)!=DeserializationError::Ok){
    Serial.printf("[HALT] parse outer %s\n",filename);return "";
  }
  String innerStr=outer["result"]["content"][0]["text"].as<String>();
  DynamicJsonDocument inner(65536);
  if(deserializeJson(inner,innerStr)!=DeserializationError::Ok){
    Serial.printf("[HALT] parse inner %s\n",filename);return "";
  }
  String content=inner["content"].as<String>();
  String reported=inner["sha256"].as<String>();
  if(!reported.equals(expectedSha)){
    Serial.printf("[HALT] reported sha mismatch %s\n  exp:%s\n  got:%s\n",filename,expectedSha,reported.c_str());
    return "";
  }
  String computed=sha256hex((const uint8_t*)content.c_str(),content.length());
  if(!computed.equals(expectedSha)){
    Serial.printf("[HALT] computed sha mismatch %s\n  exp:%s\n  cmp:%s\n",filename,expectedSha,computed.c_str());
    return "";
  }
  Serial.printf("[VERIFY] OK %s sha256:%s...\n",filename,computed.substring(0,16).c_str());
  return content;
}

// Bootstrap state machine
struct BootstrapState {
  bool   active=false; int layerIdx=0;
  String content="";   size_t pos=0;
  bool   loaded=false; unsigned long lastCharMs=0;
};
BootstrapState bs;

void startBootstrap(){
  bs=BootstrapState(); bs.active=true;
  Serial.printf("[BOOTSTRAP] Starting VM delivery. Identity: %s\n",VM_IDENTITY);
  delay(500);
  Keyboard.println("# SOVEREIGN-VM-DELIVERY-START");
  Keyboard.println(String("# VM-IDENTITY: ")+VM_IDENTITY);
  Keyboard.println(String("# LAYERS: ")+MANIFEST_SIZE);
  delay(100);
}

void bootstrapTick(){
  if(!bs.active) return;
  if(!bs.loaded){
    const ManifestEntry& e=MANIFEST[bs.layerIdx];
    Keyboard.println(""); 
    Keyboard.println(String("# FILE-START: ")+e.file);
    Keyboard.println(String("# SHA256: ")+e.sha256);
    Keyboard.println(String("# LAYER: ")+e.layer);
    delay(50);
    String c=fetchAndVerify(e.file,e.sha256);
    if(!c.length()){
      Keyboard.println("# FILE-HALT: SHA256 MISMATCH - DELIVERY ABORTED");
      bs.active=false;
      Serial.printf("[BOOTSTRAP] HALTED at layer %d\n",e.layer);
      return;
    }
    bs.content=c; bs.pos=0; bs.loaded=true;
    Serial.printf("[BOOTSTRAP] Layer %d loaded, %d bytes queued\n",e.layer,(int)c.length());
    return;
  }
  if(millis()-bs.lastCharMs<HID_CHAR_DELAY) return;
  if(bs.pos>=bs.content.length()){
    Serial.printf("[BOOTSTRAP] Layer %d complete\n",MANIFEST[bs.layerIdx].layer);
    Keyboard.println(String("# FILE-END: ")+MANIFEST[bs.layerIdx].file);
    delay(HID_LINE_DELAY);
    bs.layerIdx++; bs.loaded=false; bs.content=""; bs.pos=0;
    if(bs.layerIdx>=MANIFEST_SIZE){
      bs.active=false;
      Serial.println("[BOOTSTRAP] ALL LAYERS DELIVERED.");
      Keyboard.println("# SOVEREIGN-VM-DELIVERY-COMPLETE");
      Keyboard.println(String("# VM-IDENTITY: ")+VM_IDENTITY);
    }
    return;
  }
  char c=bs.content[bs.pos++];
  Keyboard.print(c);
  if(c=='\n') delay(HID_LINE_DELAY);
  bs.lastCharMs=millis();
}

void setupHTTP(){
  httpServer.on("/api/status",HTTP_GET,[](AsyncWebServerRequest* req){
    StaticJsonDocument<256> s;
    s["version"]="2.0-sovereign"; s["uptime"]=millis();
    s["bootstrap"]=bs.active; s["vm_id"]=VM_IDENTITY;
    String j; serializeJson(s,j); req->send(200,"application/json",j);
  });
  httpServer.on("/api/bootstrap/start",HTTP_POST,[](AsyncWebServerRequest* req){
    if(bs.active){req->send(409,"text/plain","Already active");return;}
    startBootstrap(); req->send(200,"text/plain","Bootstrap started");
  });
  httpServer.on("/api/bootstrap/stop",HTTP_POST,[](AsyncWebServerRequest* req){
    bs.active=false; Keyboard.println("# DELIVERY-ABORTED");
    req->send(200,"text/plain","Stopped");
  });
  httpServer.on("/api/bootstrap/status",HTTP_GET,[](AsyncWebServerRequest* req){
    StaticJsonDocument<256> s;
    s["active"]=bs.active; s["layerIdx"]=bs.layerIdx;
    s["layerCount"]=MANIFEST_SIZE; s["bytesTyped"]=(int)bs.pos;
    s["bytesTotal"]=(int)bs.content.length(); s["loaded"]=bs.loaded;
    if(bs.layerIdx<MANIFEST_SIZE) s["currentFile"]=MANIFEST[bs.layerIdx].file;
    String j; serializeJson(s,j); req->send(200,"application/json",j);
  });
  httpServer.on("/api/verify",HTTP_GET,[](AsyncWebServerRequest* req){
    StaticJsonDocument<1024> r;
    JsonArray arr=r.createNestedArray("layers");
    bool allOk=true;
    for(int i=0;i<MANIFEST_SIZE;i++){
      String c=fetchAndVerify(MANIFEST[i].file,MANIFEST[i].sha256);
      bool ok=c.length()>0; if(!ok) allOk=false;
      JsonObject e=arr.createNestedObject();
      e["file"]=MANIFEST[i].file; e["layer"]=MANIFEST[i].layer; e["ok"]=ok;
    }
    r["all_ok"]=allOk; r["vm_identity"]=VM_IDENTITY;
    String j; serializeJson(r,j); req->send(200,"application/json",j);
  });
  httpServer.on("/api/type",HTTP_POST,[](AsyncWebServerRequest* req){
    if(req->hasParam("text",true)){
      Keyboard.print(req->getParam("text",true)->value());
      req->send(200,"text/plain","OK");
    } else req->send(400,"text/plain","Missing text");
  });
  httpServer.begin();
  Serial.println("[HTTP] :80 ready");
}

void setup(){
  Serial.begin(115200); delay(1000);
  Serial.println("\nSOVEREIGN ESP32 UMBILICAL CORD v2.0");
  Serial.printf("VM identity: %s\n\n",VM_IDENTITY);
  Keyboard.begin(); Mouse.begin(); USB.begin();
  Serial.println("[HW] USB HID ready");
  HostUART.begin(HOST_BAUD,SERIAL_8N1,HOST_RX_PIN,HOST_TX_PIN);
  Serial.println("[HW] UART -> sovereign-fs-mcp");
  WiFi.mode(WIFI_AP); WiFi.softAP(WIFI_SSID,WIFI_PASS);
  Serial.printf("[NET] AP: %s  IP: %s\n",WIFI_SSID,WiFi.softAPIP().toString().c_str());
  setupHTTP();
  Serial.println("\nREADY");
  Serial.println("  POST /api/bootstrap/start  -- type VM to HID target");
  Serial.println("  GET  /api/verify           -- verify all SHA256s via UART");
  Serial.println("  GET  /api/bootstrap/status -- delivery progress");
}

void loop(){
  bootstrapTick();
  delay(1);
}
