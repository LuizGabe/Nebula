"""Generate localized README headers with stdlib only; run from any directory."""

from html import escape
from pathlib import Path
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "assets" / "readme"
SVG_NS = "http://www.w3.org/2000/svg"

COPY = {
    "en": {
        "tagline": "From audio to working knowledge.",
        "note": "Audio capture / asynchronous processing / AI documents",
        "steps": ["Record", "Transcribe", "Generate", "Review"],
        "description": "An engineering notebook sketch: record, transcribe, generate and review.",
    },
    "pt-BR": {
        "tagline": "Do áudio ao conhecimento organizado.",
        "note": "Captura de áudio / processamento assíncrono / documentos com IA",
        "steps": ["Grave", "Transcreva", "Gere", "Revise"],
        "description": "Um esboço de caderno de engenharia: grave, transcreva, gere e revise.",
    },
}
THEMES = {
    "light": {"ink": "#30223f", "muted": "#665678", "accent": "#714ba8", "surface": "#f3edf9"},
    "dark": {"ink": "#eee5f8", "muted": "#c0afcf", "accent": "#c5a4ed", "surface": "#282032"},
}


def logo_markup() -> str:
    # Embed the application's actual icon, retaining its editable vector paths.
    ET.register_namespace("", SVG_NS)
    source = ET.parse(ROOT / "apps/web/src/assets/nebula-icon.svg").getroot()
    return "".join(
        ET.tostring(child, encoding="unicode")
        for child in source
        if child.tag not in {f"{{{SVG_NS}}}title", f"{{{SVG_NS}}}desc"}
    )


def render(language: str, theme: str, logo: str) -> str:
    copy = COPY[language]
    colors = THEMES[theme]
    steps = []
    for index, label in enumerate(copy["steps"]):
        x = 40 + index * 242
        steps.append(f'''<g transform="translate({x} 168)">
      <rect width="194" height="52" rx="12" fill="{colors['surface']}"/>
      <text x="16" y="32" font-size="12" fill="{colors['muted']}" font-family="ui-monospace, monospace">0{index + 1}</text>
      <text x="48" y="33" font-size="18" font-weight="600">{escape(label)}</text>
    </g>''')
        if index < 3:
            start = x + 204
            steps.append(f'''<path d="M{start} 195 Q{start + 13} 190 {start + 28} 194 m-7 -5 7 5 -7 5"
      fill="none" stroke="{colors['accent']}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>''')

    return f'''<svg xmlns="{SVG_NS}" width="1000" height="260" viewBox="0 0 1000 260" role="img" aria-labelledby="title description" xml:lang="{language}">
  <title id="title">Nebula — {escape(copy['tagline'])}</title>
  <desc id="description">{escape(copy['description'])}</desc>
  <defs>
    <pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse">
      <path d="M24 0H0V24" fill="none" stroke="{colors['accent']}" stroke-opacity=".11" stroke-width="1"/>
    </pattern>
  </defs>
  <rect x="1" y="1" width="998" height="258" rx="18" fill="url(#grid)"/>
  <g fill="{colors['ink']}" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif">
    <text x="40" y="66" font-size="42" font-weight="700" letter-spacing="-1.5">Nebula</text>
    <path d="M40 79 Q101 73 175 80" fill="none" stroke="{colors['accent']}" stroke-width="2" stroke-linecap="round"/>
    <text x="40" y="116" font-size="26" font-weight="500">{escape(copy['tagline'])}</text>
    <text x="41" y="143" font-size="14" fill="{colors['muted']}">{escape(copy['note'])}</text>
    <g transform="translate(823 9) scale(.65)" aria-hidden="true">{logo}</g>
    {''.join(steps)}
  </g>
</svg>
'''


def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    logo = logo_markup()
    for language in COPY:
        for theme in THEMES:
            path = OUTPUT / f"header.{language}.{theme}.svg"
            path.write_text(render(language, theme, logo), encoding="utf-8", newline="\n")
            print(path.relative_to(ROOT))


if __name__ == "__main__":
    main()
