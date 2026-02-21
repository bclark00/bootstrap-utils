#!/usr/bin/env python3
"""
Claude Springboard - Elevated Worker Pattern
Separates UI (unprivileged) from execution (privileged)

Architecture:
- UI Process: Runs as regular user, shows tray icon
- Worker Process: Runs with elevated privileges, executes commands
- Communication: Unix socket with permission checks

Brandon Clark - 2025-02-14
"""

import gi
gi.require_version('Gtk', '3.0')
from gi.repository import Gtk, GLib
import subprocess
import json
import os
import socket
import threading
import time
from pathlib import Path
import struct

# ============================================================================
# WORKER PROCESS (Elevated)
# ============================================================================

class ElevatedWorker:
    """Worker process that executes commands with elevated privileges"""
    
    def __init__(self, socket_path):
        self.socket_path = socket_path
        self.log_file = f"{Path.home()}/.claude-springboard-worker.log"
        self.running = True
        
    def log(self, message):
        timestamp = time.strftime("%Y-%m-%d %H:%M:%S")
        with open(self.log_file, 'a') as f:
            f.write(f"[WORKER][{timestamp}] {message}\n")
        print(f"[WORKER][{timestamp}] {message}")
    
    def validate_command(self, command):
        """Validate command before execution"""
        cmd_type = command.get('type')
        
        # Whitelist of allowed command types
        allowed_types = {
            'launch_diamond_lattice',
            'launch_scout',
            'notify',
            'exec',
            'system_stats',
            # ARDS substrate operations
            'ards_submit',
            'ards_read',
            'ards_verify',
            'ards_stats',
            'ards_flush',
        }
        
        if cmd_type not in allowed_types:
            self.log(f"REJECTED: Unknown command type: {cmd_type}")
            return False
        
        # Validate exec commands
        if cmd_type == 'exec':
            cmd_str = command.get('data', {}).get('command', '')
            
            # Blacklist dangerous commands
            dangerous = ['rm -rf /', 'dd if=', 'mkfs', ':(){:|:&};:', 'fork bomb']
            if any(d in cmd_str.lower() for d in dangerous):
                self.log(f"REJECTED: Dangerous command blocked: {cmd_str}")
                return False
        
        return True
    
    def execute_command(self, command):
        """Execute validated command"""
        cmd_type = command.get('type')
        cmd_data = command.get('data', {})
        
        self.log(f"Executing: {cmd_type}")
        
        try:
            if cmd_type == 'launch_diamond_lattice':
                home = str(Path.home())
                subprocess.Popen(
                    [f"{home}/Desktop-from-nested/immersive-desktop/launch-diamond-lattice.sh"],
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE
                )
                return {'status': 'success', 'message': 'Diamond Lattice launched'}
            
            elif cmd_type == 'launch_scout':
                subprocess.Popen(
                    ['gnome-terminal', '--', 'bash', '-c', 'source ~/.bashrc && scout shell; exec bash'],
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE
                )
                return {'status': 'success', 'message': 'Scout launched'}
            
            elif cmd_type == 'notify':
                title = cmd_data.get('title', 'Claude')
                message = cmd_data.get('message', '')
                subprocess.run(['notify-send', title, message])
                return {'status': 'success', 'message': 'Notification sent'}
            
            elif cmd_type == 'exec':
                cmd_str = cmd_data.get('command', '')
                result = subprocess.run(
                    cmd_str,
                    shell=True,
                    capture_output=True,
                    text=True,
                    timeout=30
                )
                return {
                    'status': 'success',
                    'stdout': result.stdout,
                    'stderr': result.stderr,
                    'returncode': result.returncode
                }
            
            elif cmd_type == 'system_stats':
                home = str(Path.home())
                db_path = f"{home}/zorin/.illuminaughty/diamonds.db"
                if os.path.exists(db_path):
                    result = subprocess.run(
                        ['sqlite3', db_path, 'SELECT COUNT(*) FROM diamonds'],
                        capture_output=True,
                        text=True
                    )
                    count = result.stdout.strip()
                else:
                    count = "0"
                
                return {'status': 'success', 'diamond_count': count}
        
            elif cmd_type == 'ards_submit':
                result = subprocess.run(
                    ['/home/zorin/ards-kernel-driver/ards-ioctl', 'submit',
                     str(cmd_data.get('type', 255)),
                     cmd_data.get('key', 'unknown'),
                     cmd_data.get('payload', '')],
                    capture_output=True, text=True, timeout=10
                )
                if result.returncode != 0:
                    return {'status': 'error', 'message': result.stderr.strip()}
                data = json.loads(result.stdout.strip())
                return {'status': 'success', **data}

            elif cmd_type == 'ards_read':
                result = subprocess.run(
                    ['/home/zorin/ards-kernel-driver/ards-ioctl', 'read',
                     str(cmd_data.get('seq', 1))],
                    capture_output=True, text=True, timeout=10
                )
                if result.returncode != 0:
                    return {'status': 'error', 'message': result.stderr.strip()}
                return {'status': 'success', 'record': json.loads(result.stdout.strip())}

            elif cmd_type == 'ards_verify':
                result = subprocess.run(
                    ['/home/zorin/ards-kernel-driver/ards-ioctl', 'verify'],
                    capture_output=True, text=True, timeout=30
                )
                if result.returncode != 0:
                    return {'status': 'error', 'message': result.stderr.strip()}
                return {'status': 'success', **json.loads(result.stdout.strip())}

            elif cmd_type == 'ards_stats':
                result = subprocess.run(
                    ['/home/zorin/ards-kernel-driver/ards-ioctl', 'stats'],
                    capture_output=True, text=True, timeout=10
                )
                if result.returncode != 0:
                    return {'status': 'error', 'message': result.stderr.strip()}
                return {'status': 'success', **json.loads(result.stdout.strip())}

            elif cmd_type == 'ards_flush':
                result = subprocess.run(
                    ['/home/zorin/ards-kernel-driver/ards-ioctl', 'flush'],
                    capture_output=True, text=True, timeout=10
                )
                if result.returncode != 0:
                    return {'status': 'error', 'message': result.stderr.strip()}
                return {'status': 'success', **json.loads(result.stdout.strip())}

        except Exception as e:
            self.log(f"Execution error: {e}")
            return {'status': 'error', 'message': str(e)}
    
    def handle_client(self, client_socket, addr):
        """Handle incoming command from UI"""
        try:
            # Receive message length (4 bytes)
            length_data = client_socket.recv(4)
            if not length_data:
                return
            
            msg_length = struct.unpack('!I', length_data)[0]
            
            # Receive command data
            data = b''
            while len(data) < msg_length:
                chunk = client_socket.recv(min(msg_length - len(data), 4096))
                if not chunk:
                    break
                data += chunk
            
            # Parse and validate
            command = json.loads(data.decode('utf-8'))
            
            if not self.validate_command(command):
                response = {'status': 'error', 'message': 'Command validation failed'}
            else:
                response = self.execute_command(command)
            
            # Send response
            response_data = json.dumps(response).encode('utf-8')
            client_socket.sendall(struct.pack('!I', len(response_data)) + response_data)
        
        except Exception as e:
            self.log(f"Client handling error: {e}")
        finally:
            client_socket.close()
    
    def run(self):
        """Main worker loop"""
        self.log("Elevated worker starting...")
        
        # Remove old socket if exists
        if os.path.exists(self.socket_path):
            os.remove(self.socket_path)
        
        # Create Unix socket
        server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        server.bind(self.socket_path)
        os.chmod(self.socket_path, 0o600)  # Owner only
        server.listen(5)
        
        self.log(f"Worker listening on {self.socket_path}")
        
        while self.running:
            try:
                client, addr = server.accept()
                # Handle in separate thread
                threading.Thread(target=self.handle_client, args=(client, addr), daemon=True).start()
            except Exception as e:
                self.log(f"Accept error: {e}")
        
        server.close()

# ============================================================================
# UI PROCESS (Unprivileged)
# ============================================================================

class SpringboardUI:
    """UI process - shows tray icon, sends commands to worker"""
    
    def __init__(self, socket_path):
        self.socket_path = socket_path
        self.home = str(Path.home())
        self.command_file = f"{self.home}/.claude-springboard-commands.jsonl"
        self.log_file = f"{self.home}/.claude-springboard-ui.log"
        
        # Create status icon
        self.icon = Gtk.StatusIcon()
        self.icon.set_from_icon_name("system-run")
        self.icon.set_tooltip_text("Claude Springboard")
        self.icon.connect("popup-menu", self.on_popup_menu)
        self.icon.connect("activate", self.on_activate)
        
        # Start command watcher
        self.watching = True
        self.watch_thread = threading.Thread(target=self.watch_commands, daemon=True)
        self.watch_thread.start()
        
        self.log("Springboard UI started")
    
    def log(self, message):
        timestamp = time.strftime("%Y-%m-%d %H:%M:%S")
        with open(self.log_file, 'a') as f:
            f.write(f"[UI][{timestamp}] {message}\n")
        print(f"[UI][{timestamp}] {message}")
    
    def send_to_worker(self, command):
        """Send command to elevated worker via socket"""
        try:
            # Connect to worker
            sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            sock.connect(self.socket_path)
            
            # Send command
            cmd_data = json.dumps(command).encode('utf-8')
            sock.sendall(struct.pack('!I', len(cmd_data)) + cmd_data)
            
            # Receive response
            length_data = sock.recv(4)
            if length_data:
                resp_length = struct.unpack('!I', length_data)[0]
                resp_data = b''
                while len(resp_data) < resp_length:
                    chunk = sock.recv(min(resp_length - len(resp_data), 4096))
                    if not chunk:
                        break
                    resp_data += chunk
                
                response = json.loads(resp_data.decode('utf-8'))
                self.log(f"Worker response: {response.get('status')}")
                return response
            
            sock.close()
        
        except Exception as e:
            self.log(f"Worker communication error: {e}")
            return {'status': 'error', 'message': str(e)}
    
    def watch_commands(self):
        """Watch command file for new commands from Claude"""
        if not os.path.exists(self.command_file):
            Path(self.command_file).touch()
        
        last_pos = 0
        
        while self.watching:
            try:
                if os.path.exists(self.command_file):
                    file_size = os.path.getsize(self.command_file)
                    
                    if file_size > last_pos:
                        with open(self.command_file, 'r') as f:
                            f.seek(last_pos)
                            new_lines = f.readlines()
                            last_pos = f.tell()
                        
                        for line in new_lines:
                            if line.strip():
                                try:
                                    command = json.loads(line)
                                    self.send_to_worker(command)
                                except json.JSONDecodeError:
                                    self.log(f"Invalid JSON: {line}")
            
            except Exception as e:
                self.log(f"Watcher error: {e}")
            
            time.sleep(0.5)
    
    def on_activate(self, icon):
        self.send_to_worker({
            'type': 'notify',
            'data': {'title': 'Claude Springboard', 'message': 'System Active'}
        })
    
    def on_popup_menu(self, icon, button, time):
        menu = Gtk.Menu()
        
        status = Gtk.MenuItem(label="🚀 Claude Springboard (Elevated Worker)")
        status.set_sensitive(False)
        menu.append(status)
        menu.append(Gtk.SeparatorMenuItem())
        
        self.add_menu_item(menu, "💎 Launch Diamond Lattice", 
                          lambda w: self.send_to_worker({'type': 'launch_diamond_lattice'}))
        self.add_menu_item(menu, "🔍 Launch Scout Shell",
                          lambda w: self.send_to_worker({'type': 'launch_scout'}))
        self.add_menu_item(menu, "📊 System Stats",
                          lambda w: self.show_stats())
        
        menu.append(Gtk.SeparatorMenuItem())
        
        self.add_menu_item(menu, "📝 View UI Log", self.view_ui_log)
        self.add_menu_item(menu, "📝 View Worker Log", self.view_worker_log)
        self.add_menu_item(menu, "❌ Quit", self.quit)
        
        menu.show_all()
        menu.popup(None, None, None, None, button, time)
    
    def add_menu_item(self, menu, label, callback):
        item = Gtk.MenuItem(label=label)
        item.connect('activate', callback)
        menu.append(item)
    
    def show_stats(self):
        response = self.send_to_worker({'type': 'system_stats'})
        if response.get('status') == 'success':
            count = response.get('diamond_count', 'N/A')
            self.send_to_worker({
                'type': 'notify',
                'data': {
                    'title': 'Claude Intelligence System',
                    'message': f'💎 Diamonds: {count}\n📊 System: Operational'
                }
            })
    
    def view_ui_log(self, widget):
        subprocess.Popen(['gnome-text-editor', self.log_file])
    
    def view_worker_log(self, widget):
        subprocess.Popen(['gnome-text-editor', f"{self.home}/.claude-springboard-worker.log"])
    
    def quit(self, widget):
        self.watching = False
        Gtk.main_quit()

# ============================================================================
# LAUNCHER
# ============================================================================

def main():
    import sys
    
    socket_path = f"{Path.home()}/.claude-springboard.sock"
    
    if len(sys.argv) > 1 and sys.argv[1] == '--worker':
        # Run as elevated worker
        worker = ElevatedWorker(socket_path)
        worker.run()
    else:
        # Run as UI
        ui = SpringboardUI(socket_path)
        Gtk.main()

if __name__ == '__main__':
    main()
