"""
scaffold.py - Composable projection system for structured content rendering.

METHODOLOGY
-----------
Three distinct layers, kept strictly separate:

  Block      - A typed slot that holds data and declares its own schema.
               Pure. Deterministic. No rendering logic.
               Composed into trees to form a Scaffold (the IR).

  Scaffold   - An ordered, labeled tree of Blocks.
               The Intermediate Representation. Hashed for identity.
               Same Scaffold + same data = same content_id, always.

  Projector  - A registered function: (block, data, ctx) -> str
               Maps (block_type, target) pairs to output.
               Temporal: projectors are versioned and swappable.
               Multiple targets from one Scaffold.

TARGETS (built-in)
------------------
  html       - Styled cards via html_utils.py (Jupyter/browser)
  md         - Plain markdown (README, GitHub, docs)
  json       - Structured dict (API, storage, inter-system)
  sql        - INSERT statements (AuditNexus, VaultDB, GenesisDB)

EXPONENTIAL HOOK
----------------
Every Block emits schema(). A Scaffold emits its full schema tree.
That schema is itself a valid input to build new Scaffolds.
Tools that generate Scaffolds from schemas close the loop.

USAGE
-----
    from scaffold import Scaffold, TextBlock, TableBlock, ImageBlock, project

    s = Scaffold("agent_response", [
        TextBlock("header", style="title"),
        TableBlock("results", columns=["name", "score"]),
    ])

    html_out  = s.project(data, target="html")
    md_out    = s.project(data, target="md")
    json_out  = s.project(data, target="json")
    sql_out   = s.project(data, target="sql", table="audit_log")

BACKWARD COMPATIBILITY
----------------------
html_utils.py is unchanged. The html projectors delegate to it.
Existing display_card() / render_content() calls continue to work.
"""

from __future__ import annotations

import hashlib
import html as _html
import json
import pprint
import textwrap
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable, Dict, List, Optional, Tuple

# ---------------------------------------------------------------------------
# Optional: html_utils integration
# ---------------------------------------------------------------------------
try:
    from html_utils import (
        CARD_CSS,
        _render_markdown_text,
        _render_dataframe,
        _render_series,
        _render_code_block,
        _is_dataframe,
        _is_series,
        display,
        HTML,
    )
    _HTML_UTILS = True
except ImportError:
    _HTML_UTILS = False
    CARD_CSS = ""

    def _render_markdown_text(text: str) -> str:
        return f"<pre>{_html.escape(text)}</pre>"

    def _render_code_block(text: str) -> str:
        return f"<pre><code>{_html.escape(text)}</code></pre>"

    def _is_dataframe(x: Any) -> bool:
        return False

    def _is_series(x: Any) -> bool:
        return False

    def display(obj: Any) -> None:
        print(getattr(obj, "data", obj))

    class HTML:
        def __init__(self, data: str):
            self.data = data


# ===========================================================================
# LAYER 1: BLOCKS
# The atomic unit. Typed, self-describing, no rendering logic.
# ===========================================================================

class Block:
    """
    Base class for all scaffold blocks.

    A Block declares:
      - slot_name:  its label within the parent Scaffold
      - block_type: its kind (used to look up projectors in the registry)
      - schema():   a dict describing itself (enables code generation)
      - children:   nested Blocks (enables composition)

    No rendering logic lives here. Blocks are pure data containers.
    """

    block_type: str = "base"

    def __init__(self, slot_name: str, children: Optional[List[Block]] = None, **kwargs):
        self.slot_name = slot_name
        self.children: List[Block] = children or []
        self._meta: Dict[str, Any] = kwargs  # block-specific options

    def schema(self) -> Dict[str, Any]:
        """Emit a self-describing schema dict. Recursive over children."""
        s: Dict[str, Any] = {
            "slot": self.slot_name,
            "type": self.block_type,
        }
        if self._meta:
            s["options"] = self._meta
        if self.children:
            s["children"] = [c.schema() for c in self.children]
        return s

    def __repr__(self) -> str:
        return f"{self.__class__.__name__}({self.slot_name!r})"


# ---------------------------------------------------------------------------
# Concrete block types
# ---------------------------------------------------------------------------

class TextBlock(Block):
    """
    Renders a text value. Supports markdown, plain, code, and title styles.

    Options:
        style: "plain" | "markdown" | "code" | "title"  (default: "markdown")
    """
    block_type = "text"

    def __init__(self, slot_name: str, style: str = "markdown", **kwargs):
        super().__init__(slot_name, style=style, **kwargs)

    @property
    def style(self) -> str:
        return self._meta.get("style", "markdown")


class TableBlock(Block):
    """
    Renders tabular data. Accepts DataFrame, list-of-dicts, or list-of-lists.

    Options:
        columns:    explicit column list (optional; inferred if absent)
        max_rows:   truncate to N rows (default: unlimited)
        index:      show index in html output (default: False)
    """
    block_type = "table"

    def __init__(self, slot_name: str, columns: Optional[List[str]] = None,
                 max_rows: Optional[int] = None, index: bool = False, **kwargs):
        super().__init__(slot_name, columns=columns, max_rows=max_rows,
                         index=index, **kwargs)

    @property
    def columns(self) -> Optional[List[str]]:
        return self._meta.get("columns")

    @property
    def max_rows(self) -> Optional[int]:
        return self._meta.get("max_rows")


class ImageBlock(Block):
    """
    Renders an image. Data value should be a file path (str) or raw bytes.

    Options:
        alt:    alt text (default: "image")
        mime:   MIME type (default: "image/png")
    """
    block_type = "image"

    def __init__(self, slot_name: str, alt: str = "image",
                 mime: str = "image/png", **kwargs):
        super().__init__(slot_name, alt=alt, mime=mime, **kwargs)


class StatsBlock(Block):
    """
    Renders a horizontal stats bar: label -> value pairs.

    Options:
        fields:  list of field names to pull from data dict (default: all keys)
        fmt:     dict of field -> format string, e.g. {"cost": "${:.2f}"}
    """
    block_type = "stats"

    def __init__(self, slot_name: str, fields: Optional[List[str]] = None,
                 fmt: Optional[Dict[str, str]] = None, **kwargs):
        super().__init__(slot_name, fields=fields, fmt=fmt or {}, **kwargs)

    @property
    def fields(self) -> Optional[List[str]]:
        return self._meta.get("fields")

    @property
    def fmt(self) -> Dict[str, str]:
        return self._meta.get("fmt", {})


class ContainerBlock(Block):
    """
    A labeled group containing other blocks. Renders as a section.

    Options:
        title:      section heading (default: slot_name)
        collapsible: whether to collapse in html (default: False)
    """
    block_type = "container"

    def __init__(self, slot_name: str, children: List[Block],
                 title: Optional[str] = None, collapsible: bool = False, **kwargs):
        super().__init__(slot_name, children=children,
                         title=title, collapsible=collapsible, **kwargs)

    @property
    def title(self) -> str:
        return self._meta.get("title") or self.slot_name

    @property
    def collapsible(self) -> bool:
        return self._meta.get("collapsible", False)


class TimelineBlock(Block):
    """
    Renders a sequence of events as a vertical timeline.
    Data value should be list-of-dicts with at least a "label" key.

    Options:
        label_key:   field name for event label (default: "label")
        content_key: field name for event content (default: "content")
        color_key:   field name for event color class (default: "type")
    """
    block_type = "timeline"

    def __init__(self, slot_name: str, label_key: str = "label",
                 content_key: str = "content", color_key: str = "type", **kwargs):
        super().__init__(slot_name, label_key=label_key,
                         content_key=content_key, color_key=color_key, **kwargs)


class SchemaBlock(Block):
    """
    A meta-block. Renders the Scaffold's own schema as output.
    Used for self-description, code generation, and documentation.

    This is the exponential hook: a Scaffold containing a SchemaBlock
    can emit its own specification, which can be used to generate
    new Scaffolds or new projectors.
    """
    block_type = "schema"


# ===========================================================================
# LAYER 2: PROJECTOR REGISTRY
# Maps (block_type, target) -> projector function.
# ===========================================================================

# Registry: { (block_type, target): Callable[[Block, Any, dict], str] }
_REGISTRY: Dict[Tuple[str, str], Callable] = {}

# Projector versions: { target: version_string }
PROJECTOR_VERSION: Dict[str, str] = {}


def register(block_type: str, target: str, version: str = "1.0.0"):
    """
    Decorator: register a projector function for (block_type, target).

    Usage:
        @register("text", "html", version="1.0.0")
        def project_text_html(block: TextBlock, data: Any, ctx: dict) -> str:
            ...
    """
    def decorator(fn: Callable) -> Callable:
        _REGISTRY[(block_type, target)] = fn
        PROJECTOR_VERSION[target] = version
        return fn
    return decorator


def get_projector(block_type: str, target: str) -> Optional[Callable]:
    """Look up projector, falling back to base block type."""
    return _REGISTRY.get((block_type, target)) or _REGISTRY.get(("base", target))


# ===========================================================================
# LAYER 3: SCAFFOLD (the IR)
# A named, ordered tree of Blocks. Hashed for identity.
# ===========================================================================

def _canonical_json(obj: Any) -> str:
    """Deterministic JSON: sorted keys, no whitespace."""
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), default=str)


def _sha256(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


class Scaffold:
    """
    An ordered, labeled collection of Blocks forming the IR.

    The Scaffold is:
      - Pure:          no rendering code, only structure
      - Deterministic: same blocks + same data -> same content_id
      - Composable:    blocks can nest via ContainerBlock
      - Self-describing: schema() emits the full block tree

    project(data, target) dispatches each block's data slot to the
    registered projector for that (block_type, target) pair, then
    assembles the target-specific output.
    """

    def __init__(self, name: str, blocks: List[Block],
                 description: str = "", version: str = "1.0.0"):
        self.name = name
        self.blocks = blocks
        self.description = description
        self.version = version

    # ------------------------------------------------------------------
    # Schema (self-description)
    # ------------------------------------------------------------------

    def schema(self) -> Dict[str, Any]:
        """
        Emit the full schema of this Scaffold.
        The output is a valid spec that can regenerate the Scaffold.
        """
        return {
            "scaffold": self.name,
            "version": self.version,
            "description": self.description,
            "blocks": [b.schema() for b in self.blocks],
        }

    # ------------------------------------------------------------------
    # Content identity (deterministic)
    # ------------------------------------------------------------------

    def _content_body(self, data: Dict[str, Any], target: str) -> Dict[str, Any]:
        """Build the deterministic content body for hashing."""
        return {
            "scaffold": self.name,
            "scaffold_version": self.version,
            "target": target,
            "schema_hash": "sha256:" + _sha256(_canonical_json(self.schema())),
            "data_hash": "sha256:" + _sha256(_canonical_json(data)),
        }

    def content_id(self, data: Dict[str, Any], target: str) -> str:
        """
        Deterministic content identity. Same scaffold + same data
        + same target = same id, always, on any machine.
        """
        body = _canonical_json(self._content_body(data, target))
        return "content_sha256:" + _sha256(body)

    # ------------------------------------------------------------------
    # Receipt (temporal, chained)
    # ------------------------------------------------------------------

    def receipt(self, data: Dict[str, Any], target: str,
                prev_receipt_hash: Optional[str] = None,
                governance: Optional[Dict] = None) -> Dict[str, Any]:
        """
        Build a projection receipt. Temporal: includes timestamp and
        chain pointer. Does NOT affect content identity.
        """
        cid = self.content_id(data, target)
        receipt_body = {
            "type": "projection_receipt",
            "schema_version": "1.0",
            "timestamp_utc": datetime.now(timezone.utc).isoformat(),
            "scaffold": self.name,
            "target": target,
            "content_id": cid,
            "prev_receipt_hash": prev_receipt_hash,
            "governance": governance or {
                "policy_gate": None,
                "promotion_result": None,
                "attestor_pubkey": None,
                "signature": None,
            },
        }
        canonical = _canonical_json(receipt_body)
        receipt_hash = "sha256:" + _sha256(canonical)
        return {
            "receipt_id": "receipt_sha256:" + _sha256(canonical),
            "receipt_hash": receipt_hash,
            **receipt_body,
        }

    # ------------------------------------------------------------------
    # Projection
    # ------------------------------------------------------------------

    def project(self, data: Dict[str, Any], target: str, **ctx_kwargs) -> str:
        """
        Project this Scaffold against data for the given target.

        data:   dict mapping slot_name -> value
        target: "html" | "md" | "json" | "sql" | any registered target
        ctx_kwargs: extra context passed to projectors (e.g. table="audit_log")

        Returns the assembled output string.
        """
        ctx = {"scaffold": self, "target": target, **ctx_kwargs}
        assembler = get_assembler(target)
        if assembler is None:
            raise ValueError(
                f"No assembler registered for target {target!r}. "
                f"Available: {list_targets()}"
            )
        return assembler(self, data, ctx)

    def display(self, data: Dict[str, Any], target: str = "html",
                title: Optional[str] = None, **ctx_kwargs) -> None:
        """
        Project and display inline (Jupyter / terminal fallback).
        Only meaningful for html target; others print to stdout.
        """
        output = self.project(data, target=target, **ctx_kwargs)
        if target == "html":
            card_title = title or self.name
            title_html = (
                f'<div class="pretty-title">{_html.escape(card_title)}</div>'
            )
            card = f'<div class="pretty-card">{title_html}{output}</div>'
            display(HTML(CARD_CSS + card))
        else:
            print(output)

    def __repr__(self) -> str:
        block_names = [b.slot_name for b in self.blocks]
        return f"Scaffold({self.name!r}, blocks={block_names})"


# ===========================================================================
# ASSEMBLERS
# One per target. An assembler iterates blocks, dispatches projectors,
# then assembles the target-specific wrapper.
# ===========================================================================

_ASSEMBLERS: Dict[str, Callable] = {}


def register_assembler(target: str):
    """Decorator: register an assembler for a target."""
    def decorator(fn: Callable) -> Callable:
        _ASSEMBLERS[target] = fn
        return fn
    return decorator


def get_assembler(target: str) -> Optional[Callable]:
    return _ASSEMBLERS.get(target)


def list_targets() -> List[str]:
    return sorted(_ASSEMBLERS.keys())


def _project_block(block: Block, data: Dict[str, Any], ctx: dict) -> Any:
    """
    Dispatch a single block to its registered projector.
    Falls back to generic string representation if no projector found.
    """
    target = ctx["target"]
    value = data.get(block.slot_name)

    # Recurse into children first (depth-first)
    child_outputs = []
    if block.children:
        for child in block.children:
            child_outputs.append(_project_block(child, data, ctx))

    projector = get_projector(block.block_type, target)
    if projector:
        return projector(block, value, ctx, child_outputs)

    # No projector: fallback
    if target == "html":
        return _render_code_block(pprint.pformat(value))
    elif target in ("md", "sql", "json"):
        return str(value)
    return str(value)


# ===========================================================================
# HTML ASSEMBLER + PROJECTORS
# ===========================================================================

@register_assembler("html")
def _assemble_html(scaffold: Scaffold, data: Dict[str, Any], ctx: dict) -> str:
    parts = []
    for block in scaffold.blocks:
        parts.append(_project_block(block, data, ctx))
    return "\n".join(parts)


@register("text", "html", version="1.0.0")
def _proj_text_html(block: TextBlock, value: Any, ctx: dict,
                    children: list) -> str:
    if value is None:
        return ""
    text = str(value)
    style = block.style
    if style == "title":
        return f'<div class="pretty-title">{_html.escape(text)}</div>'
    elif style == "code":
        return _render_code_block(text)
    elif style == "plain":
        return f"<p>{_html.escape(text)}</p>"
    else:  # markdown (default)
        return _render_markdown_text(text)


@register("table", "html", version="1.0.0")
def _proj_table_html(block: TableBlock, value: Any, ctx: dict,
                     children: list) -> str:
    if value is None:
        return ""

    if _is_dataframe(value):
        df = value
        if block.max_rows:
            df = df.head(block.max_rows)
        idx = block._meta.get("index", False)
        cols = block.columns
        if cols:
            df = df[cols]
        return df.to_html(classes="pretty-table", index=idx,
                          border=0, escape=True)

    if _is_series(value):
        return _render_series(value)

    # list-of-dicts or list-of-lists
    if isinstance(value, list) and value:
        rows = value
        if block.max_rows:
            rows = rows[:block.max_rows]

        if isinstance(rows[0], dict):
            cols = block.columns or list(rows[0].keys())
            header = "".join(f"<th>{_html.escape(str(c))}</th>" for c in cols)
            body = ""
            for row in rows:
                body += "<tr>" + "".join(
                    f"<td>{_html.escape(str(row.get(c, '')))}</td>" for c in cols
                ) + "</tr>"
        else:
            # list-of-lists
            header = ""
            if block.columns:
                header = "".join(
                    f"<th>{_html.escape(str(c))}</th>" for c in block.columns
                )
            body = ""
            for row in rows:
                body += "<tr>" + "".join(
                    f"<td>{_html.escape(str(cell))}</td>" for cell in row
                ) + "</tr>"

        thead = f"<thead><tr>{header}</tr></thead>" if header else ""
        return (
            f'<table class="pretty-table">'
            f"{thead}<tbody>{body}</tbody></table>"
        )

    return _render_code_block(pprint.pformat(value))


@register("image", "html", version="1.0.0")
def _proj_image_html(block: ImageBlock, value: Any, ctx: dict,
                     children: list) -> str:
    if value is None:
        return ""
    import base64

    alt = block._meta.get("alt", "image")
    mime = block._meta.get("mime", "image/png")

    if isinstance(value, (bytes, bytearray)):
        b64 = base64.b64encode(value).decode()
    elif isinstance(value, str):
        with open(value, "rb") as f:
            b64 = base64.b64encode(f.read()).decode()
    else:
        return ""

    return (
        f'<img src="data:{mime};base64,{b64}" '
        f'alt="{_html.escape(alt)}" '
        f'style="max-width:100%;height:auto;border-radius:8px;">'
    )


@register("stats", "html", version="1.0.0")
def _proj_stats_html(block: StatsBlock, value: Any, ctx: dict,
                     children: list) -> str:
    if not isinstance(value, dict) or not value:
        return ""

    fields = block.fields or list(value.keys())
    fmt_map = block.fmt

    items = []
    for f in fields:
        if f not in value:
            continue
        v = value[f]
        fmt = fmt_map.get(f)
        display_val = (fmt % v) if fmt else str(v)
        label = f.replace("_", " ").title()
        items.append(
            f'<span class="stat-item">'
            f'<span class="stat-label">{_html.escape(label)}:</span> '
            f'{_html.escape(display_val)}'
            f"</span>"
        )

    if not items:
        return ""
    return f'<div class="stats-bar">{" ".join(items)}</div>'


@register("container", "html", version="1.0.0")
def _proj_container_html(block: ContainerBlock, value: Any, ctx: dict,
                          children: list) -> str:
    title = block.title
    inner = "\n".join(str(c) for c in children)

    if block.collapsible:
        return (
            f"<details><summary><strong>{_html.escape(title)}</strong></summary>"
            f"{inner}</details>"
        )
    return (
        f'<div style="margin:8px 0;">'
        f'<div class="pretty-title">{_html.escape(title)}</div>'
        f"{inner}</div>"
    )


@register("timeline", "html", version="1.0.0")
def _proj_timeline_html(block: TimelineBlock, value: Any, ctx: dict,
                         children: list) -> str:
    if not isinstance(value, list) or not value:
        return ""

    lk = block._meta.get("label_key", "label")
    ck = block._meta.get("content_key", "content")
    tk = block._meta.get("color_key", "type")

    _COLOR_MAP = {
        "system":    "#6b7280",
        "assistant": "#3b82f6",
        "tool":      "#10b981",
        "subagent":  "#9333ea",
        "result":    "#f59e0b",
        "error":     "#ef4444",
    }

    items = []
    for event in value:
        label = event.get(lk, "")
        content = event.get(ck, "")
        etype = event.get(tk, "")
        color = _COLOR_MAP.get(etype, "#e5e7eb")
        items.append(
            f'<div style="margin:6px 0;padding:8px 12px;border-radius:6px;'
            f'background:#fff;border-left:3px solid {color};">'
            f'<div style="font-size:11px;font-weight:600;text-transform:uppercase;'
            f'color:#6b7280;margin-bottom:4px;">{_html.escape(str(label))}</div>'
            f'<div style="font-size:13px;color:#111;">'
            f'{_render_markdown_text(str(content)) if content else ""}'
            f"</div></div>"
        )

    return f'<div style="margin:8px 0;">{"".join(items)}</div>'


@register("schema", "html", version="1.0.0")
def _proj_schema_html(block: SchemaBlock, value: Any, ctx: dict,
                       children: list) -> str:
    scaffold: Scaffold = ctx["scaffold"]
    schema_str = json.dumps(scaffold.schema(), indent=2)
    return _render_code_block(schema_str)


# ===========================================================================
# MARKDOWN ASSEMBLER + PROJECTORS
# ===========================================================================

@register_assembler("md")
def _assemble_md(scaffold: Scaffold, data: Dict[str, Any], ctx: dict) -> str:
    parts = [f"# {scaffold.name}\n"]
    for block in scaffold.blocks:
        parts.append(_project_block(block, data, ctx))
    return "\n\n".join(p for p in parts if p)


@register("text", "md", version="1.0.0")
def _proj_text_md(block: TextBlock, value: Any, ctx: dict,
                  children: list) -> str:
    if value is None:
        return ""
    text = str(value)
    style = block.style
    if style == "title":
        return f"## {text}"
    elif style == "code":
        return f"```\n{text}\n```"
    else:
        return text


@register("table", "md", version="1.0.0")
def _proj_table_md(block: TableBlock, value: Any, ctx: dict,
                   children: list) -> str:
    if value is None:
        return ""

    rows = None
    cols = block.columns

    if _is_dataframe(value):
        df = value
        if block.max_rows:
            df = df.head(block.max_rows)
        if cols:
            df = df[cols]
        cols = list(df.columns)
        rows = df.values.tolist()
    elif isinstance(value, list) and value:
        rows = value[:block.max_rows] if block.max_rows else value
        if isinstance(rows[0], dict):
            cols = cols or list(rows[0].keys())
            rows = [[row.get(c, "") for c in cols] for row in rows]
        else:
            cols = cols or [f"col{i}" for i in range(len(rows[0]))]
    else:
        return f"```\n{pprint.pformat(value)}\n```"

    header = "| " + " | ".join(str(c) for c in cols) + " |"
    sep = "| " + " | ".join("---" for _ in cols) + " |"
    body = "\n".join(
        "| " + " | ".join(str(cell) for cell in row) + " |"
        for row in rows
    )
    return f"{header}\n{sep}\n{body}"


@register("image", "md", version="1.0.0")
def _proj_image_md(block: ImageBlock, value: Any, ctx: dict,
                   children: list) -> str:
    if value is None:
        return ""
    alt = block._meta.get("alt", "image")
    if isinstance(value, str):
        return f"![{alt}]({value})"
    return f"*[embedded image: {alt}]*"


@register("stats", "md", version="1.0.0")
def _proj_stats_md(block: StatsBlock, value: Any, ctx: dict,
                   children: list) -> str:
    if not isinstance(value, dict):
        return ""
    fields = block.fields or list(value.keys())
    fmt_map = block.fmt
    parts = []
    for f in fields:
        if f not in value:
            continue
        v = value[f]
        fmt = fmt_map.get(f)
        display_val = (fmt % v) if fmt else str(v)
        label = f.replace("_", " ").title()
        parts.append(f"**{label}:** {display_val}")
    return "  ".join(parts)


@register("container", "md", version="1.0.0")
def _proj_container_md(block: ContainerBlock, value: Any, ctx: dict,
                        children: list) -> str:
    title = block.title
    inner = "\n\n".join(str(c) for c in children)
    return f"### {title}\n\n{inner}"


@register("timeline", "md", version="1.0.0")
def _proj_timeline_md(block: TimelineBlock, value: Any, ctx: dict,
                       children: list) -> str:
    if not isinstance(value, list):
        return ""
    lk = block._meta.get("label_key", "label")
    ck = block._meta.get("content_key", "content")
    parts = []
    for event in value:
        label = event.get(lk, "")
        content = event.get(ck, "")
        parts.append(f"**{label}**\n{content}")
    return "\n\n---\n\n".join(parts)


@register("schema", "md", version="1.0.0")
def _proj_schema_md(block: SchemaBlock, value: Any, ctx: dict,
                     children: list) -> str:
    scaffold: Scaffold = ctx["scaffold"]
    return "```json\n" + json.dumps(scaffold.schema(), indent=2) + "\n```"


# ===========================================================================
# JSON ASSEMBLER + PROJECTORS
# ===========================================================================

@register_assembler("json")
def _assemble_json(scaffold: Scaffold, data: Dict[str, Any], ctx: dict) -> str:
    result: Dict[str, Any] = {
        "scaffold": scaffold.name,
        "version": scaffold.version,
        "slots": {},
    }
    for block in scaffold.blocks:
        result["slots"][block.slot_name] = _project_block(block, data, ctx)
    return json.dumps(result, indent=2, default=str)


@register("text", "json", version="1.0.0")
def _proj_text_json(block: TextBlock, value: Any, ctx: dict,
                    children: list) -> Any:
    return value


@register("table", "json", version="1.0.0")
def _proj_table_json(block: TableBlock, value: Any, ctx: dict,
                     children: list) -> Any:
    if _is_dataframe(value):
        cols = block.columns
        df = value[cols] if cols else value
        if block.max_rows:
            df = df.head(block.max_rows)
        return json.loads(df.to_json(orient="records"))
    if isinstance(value, list):
        return value[:block.max_rows] if block.max_rows else value
    return value


@register("image", "json", version="1.0.0")
def _proj_image_json(block: ImageBlock, value: Any, ctx: dict,
                     children: list) -> Any:
    if isinstance(value, str):
        return {"type": "image_path", "path": value}
    if isinstance(value, (bytes, bytearray)):
        import base64
        return {
            "type": "image_base64",
            "mime": block._meta.get("mime", "image/png"),
            "data": base64.b64encode(value).decode(),
        }
    return None


@register("stats", "json", version="1.0.0")
def _proj_stats_json(block: StatsBlock, value: Any, ctx: dict,
                     children: list) -> Any:
    if not isinstance(value, dict):
        return value
    fields = block.fields or list(value.keys())
    return {f: value[f] for f in fields if f in value}


@register("container", "json", version="1.0.0")
def _proj_container_json(block: ContainerBlock, value: Any, ctx: dict,
                          children: list) -> Any:
    return {"title": block.title, "children": children}


@register("timeline", "json", version="1.0.0")
def _proj_timeline_json(block: TimelineBlock, value: Any, ctx: dict,
                         children: list) -> Any:
    return value


@register("schema", "json", version="1.0.0")
def _proj_schema_json(block: SchemaBlock, value: Any, ctx: dict,
                       children: list) -> Any:
    scaffold: Scaffold = ctx["scaffold"]
    return scaffold.schema()


# ===========================================================================
# SQL ASSEMBLER + PROJECTORS
# ===========================================================================

@register_assembler("sql")
def _assemble_sql(scaffold: Scaffold, data: Dict[str, Any], ctx: dict) -> str:
    table = ctx.get("table", scaffold.name.lower().replace(" ", "_"))
    timestamp = datetime.now(timezone.utc).isoformat()

    # Collect flat key-value pairs from all blocks
    row: Dict[str, Any] = {
        "scaffold_name": scaffold.name,
        "scaffold_version": scaffold.version,
        "projected_at": timestamp,
        "content_id": scaffold.content_id(data, "sql"),
    }

    for block in scaffold.blocks:
        projected = _project_block(block, data, ctx)
        if isinstance(projected, (str, int, float, bool)) or projected is None:
            row[block.slot_name] = projected
        else:
            # Complex types: serialize to JSON string
            row[block.slot_name] = json.dumps(projected, default=str)

    cols = ", ".join(row.keys())
    vals = ", ".join(
        "NULL" if v is None
        else f"'{str(v).replace(chr(39), chr(39)+chr(39))}'"
        for v in row.values()
    )
    return f"INSERT INTO {table} ({cols}) VALUES ({vals});"


# SQL projectors just return values; assembler handles formatting
@register("text", "sql", version="1.0.0")
def _proj_text_sql(block: TextBlock, value: Any, ctx: dict,
                   children: list) -> Any:
    return str(value) if value is not None else None


@register("table", "sql", version="1.0.0")
def _proj_table_sql(block: TableBlock, value: Any, ctx: dict,
                    children: list) -> Any:
    return json.dumps(_proj_table_json(block, value, ctx, children), default=str)


@register("stats", "sql", version="1.0.0")
def _proj_stats_sql(block: StatsBlock, value: Any, ctx: dict,
                    children: list) -> Any:
    return json.dumps(value, default=str) if isinstance(value, dict) else str(value)


@register("image", "sql", version="1.0.0")
def _proj_image_sql(block: ImageBlock, value: Any, ctx: dict,
                    children: list) -> Any:
    if isinstance(value, str):
        return value  # store path
    return None


@register("container", "sql", version="1.0.0")
def _proj_container_sql(block: ContainerBlock, value: Any, ctx: dict,
                         children: list) -> Any:
    return json.dumps({"title": block.title, "children": children}, default=str)


@register("timeline", "sql", version="1.0.0")
def _proj_timeline_sql(block: TimelineBlock, value: Any, ctx: dict,
                        children: list) -> Any:
    return json.dumps(value, default=str) if isinstance(value, list) else str(value)


@register("schema", "sql", version="1.0.0")
def _proj_schema_sql(block: SchemaBlock, value: Any, ctx: dict,
                      children: list) -> Any:
    scaffold: Scaffold = ctx["scaffold"]
    return json.dumps(scaffold.schema())


# ===========================================================================
# CONVENIENCE: scaffold_from_schema()
# Reconstruct a Scaffold from its emitted schema dict.
# This closes the exponential loop: schema -> Scaffold -> project -> schema.
# ===========================================================================

_BLOCK_TYPE_MAP: Dict[str, type] = {
    "text":      TextBlock,
    "table":     TableBlock,
    "image":     ImageBlock,
    "stats":     StatsBlock,
    "container": ContainerBlock,
    "timeline":  TimelineBlock,
    "schema":    SchemaBlock,
}


def scaffold_from_schema(schema: Dict[str, Any]) -> Scaffold:
    """
    Reconstruct a Scaffold from a schema dict (as emitted by Scaffold.schema()).

    Enables round-trip: scaffold -> schema -> scaffold.
    Also enables code generation: describe a scaffold in JSON, instantiate it.
    """
    def _build_block(spec: Dict[str, Any]) -> Block:
        slot = spec["slot"]
        btype = spec.get("type", "text")
        opts = spec.get("options", {})
        child_specs = spec.get("children", [])
        children = [_build_block(c) for c in child_specs]

        cls = _BLOCK_TYPE_MAP.get(btype, Block)
        if children:
            return cls(slot, children=children, **opts)
        return cls(slot, **opts)

    blocks = [_build_block(b) for b in schema.get("blocks", [])]
    return Scaffold(
        name=schema.get("scaffold", "unnamed"),
        blocks=blocks,
        description=schema.get("description", ""),
        version=schema.get("version", "1.0.0"),
    )


# ===========================================================================
# CONVENIENCE: project() top-level function
# ===========================================================================

def project(data: Dict[str, Any], scaffold: Scaffold,
            target: str = "html", **ctx_kwargs) -> str:
    """
    Top-level project function. Equivalent to scaffold.project(data, target).

    Args:
        data:        dict mapping slot_name -> value
        scaffold:    Scaffold instance
        target:      output target ("html", "md", "json", "sql")
        ctx_kwargs:  extra context (e.g. table="audit_log" for sql)

    Returns:
        Rendered string in the target format.
    """
    return scaffold.project(data, target=target, **ctx_kwargs)


# ===========================================================================
# BUILT-IN SCAFFOLDS
# Ready-to-use scaffolds for common patterns.
# ===========================================================================

#: Standard agent response card
AGENT_RESPONSE = Scaffold(
    name="agent_response",
    description="Final assistant response with optional stats",
    blocks=[
        TextBlock("response", style="markdown"),
        StatsBlock(
            "stats",
            fields=["turns", "tokens", "cost_usd", "duration_s"],
            fmt={"cost_usd": "$%.2f", "duration_s": "%.1fs"},
        ),
    ],
)

#: Conversation timeline
CONVERSATION_TIMELINE = Scaffold(
    name="conversation_timeline",
    description="Full agent conversation as timeline events",
    blocks=[
        TextBlock("header", style="title"),
        TimelineBlock(
            "events",
            label_key="label",
            content_key="content",
            color_key="type",
        ),
        StatsBlock(
            "stats",
            fields=["turns", "tokens", "cost_usd", "duration_s"],
            fmt={"cost_usd": "$%.2f", "duration_s": "%.1fs"},
        ),
    ],
)

#: Data table with title
DATA_TABLE = Scaffold(
    name="data_table",
    description="Titled data table",
    blocks=[
        TextBlock("title", style="title"),
        TableBlock("data"),
    ],
)

#: Self-describing scaffold (for introspection / code generation)
SCHEMA_VIEWER = Scaffold(
    name="schema_viewer",
    description="Renders the scaffold's own schema",
    blocks=[
        TextBlock("description", style="markdown"),
        SchemaBlock("schema"),
    ],
)
