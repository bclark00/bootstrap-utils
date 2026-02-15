# 🚨 MANDATORY: Exhaustive Search Protocol
## STOP - Read This BEFORE Searching for Any Code

**Last Updated**: February 15, 2026  
**Trigger**: ANY search for code, files, implementations, or "does X exist?"

---

## ⚠️ CRITICAL RULE

**NEVER say "not found" without completing ALL 6 search levels.**

If you conclude "not found" without this checklist, YOU MADE AN ERROR.

---

## The 6-Level Exhaustive Search (Required)

### ✅ Level 1: Repository Discovery
- [ ] Search local: `find /home -iname "*keyword*"`
- [ ] Search GitHub: All repos matching keyword
- [ ] Search descriptions: repos with keyword in description
- [ ] Check variations: plural, singular, related terms

### ✅ Level 2: Structure Analysis  
- [ ] Get FULL recursive tree: `/git/trees/main?recursive=1`
- [ ] Download ALL subdirectories (src/, lib/, core/, etc.)
- [ ] Check ALL branches, not just main
- [ ] Verify complete structure downloaded

### ✅ Level 3: Multi-Strategy Code Search
- [ ] Exact: `grep -rn "Term" .`
- [ ] Case-insensitive: `grep -rin "term" .`
- [ ] Comments: `grep -rn "# Term\|// Term" .`
- [ ] Imports: `grep -rn "import.*term\|from.*term" .`
- [ ] Classes/functions: `grep -rn "class.*Term\|def.*term" .`

### ✅ Level 4: Semantic Search
- [ ] Search related concepts
- [ ] Search architectural patterns
- [ ] Check design terminology

### ✅ Level 5: Conversation History
- [ ] `conversation_search("keyword")`
- [ ] Search specifications
- [ ] Find implementation references

### ✅ Level 6: Cross-Reference
- [ ] Check against known docs
- [ ] Verify with other repos
- [ ] Look for references/links

---

## 🔴 RED FLAGS - MUST Investigate Deeper

If ANY of these are true, DO NOT conclude "not found":
- ⛔ Repository has subdirectories not examined
- ⛔ Grep found even ONE match
- ⛔ Repository description mentions keyword  
- ⛔ Conversation references exist
- ⛔ Related terms found in code

---

## Example: The Illuminaughty Mistake

**WRONG (What was done):**
```bash
grep "Quartz" main-file  # Found 1 match
# Concluded: "Not in files" ❌
```

**CORRECT (What should have been done):**
```bash
# Get recursive tree → See src/ directory exists
# Download src/ subdirectory
grep -rn "Quartz" . --include="*.py"
# Found 6 matches in src/activation_field.py
# Investigate each match
# Conclude: "IS implemented in src/" ✅
```

---

## Self-Enforcement Triggers

**Before saying ANY of these phrases, RUN THE PROTOCOL:**
- "not found"
- "doesn't exist"  
- "no references to"
- "couldn't find"
- "appears to be missing"

**If you haven't completed all 6 levels, you CANNOT use these phrases.**

---

## Quick Reference Commands

```bash
# Full repository tree
curl -H "Authorization: Bearer $TOKEN" \
  "https://api.github.com/repos/$OWNER/$REPO/git/trees/main?recursive=1"

# Comprehensive grep
grep -rn "Term" . --include="*.py" --include="*.js" --include="*.md"

# Search with context
grep -rn -C 5 "Term" .

# Conversation search
conversation_search("keyword related concepts")
```

---

## Integration with Bootstrap

This file MUST be read:
1. When starting any code search
2. Before using grep
3. Before saying "not found"
4. After finding ANY match (investigate deeper)

**Location**: bootstrap-utils/CODE_SEARCH_MANDATORY.md  
**Status**: REQUIRED READING before all searches  
**Enforcement**: Self-checking - if you skip this, you made an error

---

## Success Criteria

✅ All 6 levels completed  
✅ All subdirectories examined  
✅ All checklists marked  
✅ No red flags ignored  
✅ Conversation history checked  

**ONLY THEN** can you conclude "not found".

---

**Full Protocol**: genesis-docs-lattice/EXHAUSTIVE_SEARCH_PROTOCOL.md  
**Copyright**: © 2025-2026 Brandon Clark. All Rights Reserved.
