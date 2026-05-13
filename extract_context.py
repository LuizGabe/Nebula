#!/usr/bin/env python3
"""
extract_context.py
Gera um result.txt com a árvore de arquivos e o conteúdo de cada arquivo do projeto,
pronto para ser enviado como contexto para uma IA.

Coloque este arquivo na raiz do projeto (onde ficam as pastas de apps) e execute:
    python extract_context.py
"""

import os
import re
import string
import random
from pathlib import Path

# ──────────────────────────────────────────────
# CONFIGURAÇÕES
# ──────────────────────────────────────────────

OUTPUT_FILE = "result.txt"

# Diretórios completamente ignorados (em qualquer nível)
IGNORED_DIRS = {
    "node_modules",
    "__pycache__",
    ".git",
    ".venv",
    "venv",
    ".mypy_cache",
    ".pytest_cache",
    "dist",
    "build",
    ".next",
    ".turbo",
    "coverage",
    "models",  # pastas de modelos de transcribers (ex: whisper)
}

# Arquivos ignorados por nome exato
IGNORED_FILES = {
    "package-lock.json",
    "yarn.lock",
    "pnpm-lock.yaml",
    "bun.lockb",
    "npm-debug.log",
}

# Extensões de arquivo ignoradas por nome exato
IGNORED_EXTENSIONS = {
    ".lock",
}

# Padrões de caminho que devem ser ignorados (glob-style, checado contra o caminho relativo)
# Migrations do Prisma: qualquer pasta chamada "migrations" dentro de "prisma"
IGNORED_PATH_PATTERNS = [
    # prisma/migrations/** — ignora o conteúdo mas mantém prisma/schema.prisma
    re.compile(r"(^|[\\/])prisma[\\/]migrations([\\/]|$)"),
]

# Extensões consideradas binárias (só aparecem na árvore, sem conteúdo)
BINARY_EXTENSIONS = {
    # Imagens
    ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".ico", ".webp",
    ".tiff", ".tif",
    # Áudio / vídeo
    ".mp3", ".mp4", ".wav", ".ogg", ".flac", ".aac", ".mkv", ".avi",
    ".mov", ".wmv",
    # Fontes
    ".ttf", ".otf", ".woff", ".woff2", ".eot",
    # Binários / archives
    ".exe", ".dll", ".so", ".dylib", ".bin", ".dat",
    ".zip", ".tar", ".gz", ".bz2", ".7z", ".rar",
    # Bytecode / compiled
    ".pyc", ".pyo", ".class", ".o", ".a",
    # DB / data
    ".sqlite", ".db", ".sqlite3",
    # Documentos binários
    ".pdf", ".docx", ".xlsx", ".pptx",
    # Modelos de ML
    ".pt", ".pth", ".onnx", ".bin", ".gguf", ".safetensors",
}

# Extensões explicitamente reconhecidas como texto (nunca serão tratadas como binárias)
TEXT_EXTENSIONS = {
    ".txt", ".md", ".rst", ".csv", ".tsv", ".log",
    # Web
    ".html", ".htm", ".css", ".scss", ".sass", ".less",
    # JavaScript / TypeScript
    ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs",
    # Python
    ".py", ".pyi",
    # Shell
    ".sh", ".bash", ".zsh", ".fish",
    # Config / data
    ".json", ".jsonc", ".json5", ".yaml", ".yml", ".toml", ".ini",
    ".cfg", ".conf", ".env", ".properties",
    # Docker / CI
    ".dockerfile", "dockerfile",
    # Prisma / SQL
    ".prisma", ".sql",
    # Git
    ".gitignore", ".gitattributes",
    # Outros
    ".xml", ".svg", ".graphql", ".gql", ".proto",
    ".tf", ".hcl",           # Terraform
    ".rs",                   # Rust
    ".go",                   # Go
    ".java", ".kt",          # JVM
    ".rb",                   # Ruby
    ".php",                  # PHP
    ".cs",                   # C#
    ".c", ".cpp", ".h", ".hpp",  # C/C++
    ".lua",                  # Lua
    ".r",                    # R
    ".dart",                 # Dart
    ".swift",                # Swift
    ".vue", ".svelte",       # Frontend frameworks
    ".lock",                 # Alguns lock files são texto (ex: poetry)
    ".makefile", ".mk",
}
SENSITIVE_KEYWORDS = {"SECRET", "KEY", "TOKEN", "PASSWORD", "PASS", "PRIVATE", "CERT", "PWD"}

# ──────────────────────────────────────────────
# HELPERS
# ──────────────────────────────────────────────

def is_ignored_dir(name: str) -> bool:
    return name in IGNORED_DIRS


def is_ignored_file(name: str, ext: str) -> bool:
    return name in IGNORED_FILES or ext in IGNORED_EXTENSIONS


def matches_ignored_pattern(rel_path: str) -> bool:
    normalized = rel_path.replace("\\", "/")
    return any(p.search(normalized) for p in IGNORED_PATH_PATTERNS)


def is_binary_file(path: Path) -> bool:
    ext = path.suffix.lower()
    name = path.name.lower()

    # Se a extensão é explicitamente texto, nunca é binário
    if ext in TEXT_EXTENSIONS or name in TEXT_EXTENSIONS:
        return False

    # Se a extensão é explicitamente binária, é binário
    if ext in BINARY_EXTENSIONS:
        return True

    # Fallback: tenta ler os primeiros bytes para detectar binário
    try:
        with open(path, "rb") as f:
            chunk = f.read(8192)
        # Arquivos com bytes nulos são binários
        if b"\x00" in chunk:
            return True
        # Tenta decodificar como UTF-8
        chunk.decode("utf-8")
        return False
    except (UnicodeDecodeError, OSError):
        return True


def mask_value(value: str) -> str:
    """Substitui o valor por caracteres aleatórios do mesmo tamanho."""
    chars = string.ascii_letters + string.digits
    return "".join(random.choices(chars, k=len(value)))


def parse_env_file(content: str) -> str:
    """Lê um arquivo .env e mascara valores sensíveis."""
    lines = []
    for line in content.splitlines():
        stripped = line.strip()
        # Comentário ou linha vazia — mantém
        if not stripped or stripped.startswith("#"):
            lines.append(line)
            continue
        # Tenta capturar KEY=VALUE ou KEY="VALUE"
        match = re.match(r'^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)', line)
        if match:
            key = match.group(1)
            value = match.group(2).strip()
            # Remove aspas para verificar tamanho real
            inner = value.strip('"').strip("'")
            if any(kw in key.upper() for kw in SENSITIVE_KEYWORDS):
                # Mantém as aspas, mas substitui o conteúdo
                if value.startswith('"') and value.endswith('"'):
                    masked = f'"{mask_value(inner)}"'
                elif value.startswith("'") and value.endswith("'"):
                    masked = f"'{mask_value(inner)}'"
                else:
                    masked = mask_value(inner) if inner else value
                lines.append(f"{key}={masked}")
            else:
                lines.append(line)
        else:
            lines.append(line)
    return "\n".join(lines)


def read_file_content(path: Path) -> str:
    """Lê o arquivo e retorna seu conteúdo como string."""
    if path.suffix.lower() == ".env" or path.name.startswith(".env"):
        try:
            raw = path.read_text(encoding="utf-8", errors="replace")
            return parse_env_file(raw)
        except Exception as e:
            return f"[Erro ao ler .env: {e}]"
    try:
        return path.read_text(encoding="utf-8", errors="replace")
    except Exception as e:
        return f"[Erro ao ler arquivo: {e}]"


# ──────────────────────────────────────────────
# TREE BUILDER
# ──────────────────────────────────────────────

def build_tree(root: Path, prefix: str = "", rel_root: Path = None) -> list[str]:
    """Retorna linhas da árvore de diretórios estilo `tree`."""
    if rel_root is None:
        rel_root = root

    try:
        entries = sorted(root.iterdir(), key=lambda p: (p.is_file(), p.name.lower()))
    except PermissionError:
        return [prefix + "[sem permissão]"]

    lines = []
    visible = []
    for entry in entries:
        rel = entry.relative_to(rel_root)
        if entry.is_dir():
            if is_ignored_dir(entry.name):
                continue
            if matches_ignored_pattern(str(rel)):
                continue
        else:
            if is_ignored_file(entry.name, entry.suffix.lower()):
                continue
            if matches_ignored_pattern(str(rel)):
                continue
        visible.append(entry)

    for i, entry in enumerate(visible):
        connector = "└── " if i == len(visible) - 1 else "├── "
        extension = "    " if i == len(visible) - 1 else "│   "
        lines.append(prefix + connector + entry.name)
        if entry.is_dir():
            lines.extend(build_tree(entry, prefix + extension, rel_root))

    return lines


# ──────────────────────────────────────────────
# FILE COLLECTOR
# ──────────────────────────────────────────────

def collect_files(root: Path, rel_root: Path = None):
    """Gera (Path, rel_path_str) para todos os arquivos relevantes."""
    if rel_root is None:
        rel_root = root

    try:
        entries = sorted(root.iterdir(), key=lambda p: (p.is_file(), p.name.lower()))
    except PermissionError:
        return

    for entry in entries:
        rel = entry.relative_to(rel_root)
        if entry.is_dir():
            if is_ignored_dir(entry.name):
                continue
            if matches_ignored_pattern(str(rel)):
                continue
            yield from collect_files(entry, rel_root)
        else:
            if is_ignored_file(entry.name, entry.suffix.lower()):
                continue
            if matches_ignored_pattern(str(rel)):
                continue
            yield entry, str(rel)


# ──────────────────────────────────────────────
# MAIN
# ──────────────────────────────────────────────

def main():
    root = Path(".").resolve()
    output_path = root / OUTPUT_FILE

    print(f"🔍 Extraindo contexto de: {root}")
    print(f"📄 Saída: {output_path}\n")

    sections = []

    # ── Cabeçalho ──
    sections.append("=" * 70)
    sections.append("PROJECT CONTEXT EXTRACT")
    sections.append(f"Root: {root}")
    sections.append("=" * 70)
    sections.append("")

    # ── Árvore ──
    sections.append("## FILE TREE")
    sections.append("")
    sections.append(root.name + "/")
    tree_lines = build_tree(root, rel_root=root)
    sections.extend(tree_lines)
    sections.append("")

    # ── Conteúdo dos arquivos ──
    sections.append("=" * 70)
    sections.append("## FILE CONTENTS")
    sections.append("=" * 70)
    sections.append("")

    file_count = 0
    binary_count = 0

    for file_path, rel in collect_files(root, rel_root=root):
        # Pula o próprio output para não incluir resultado anterior
        if file_path == output_path:
            continue
        # Pula o próprio script
        if file_path.name == Path(__file__).name:
            continue

        sections.append(f"### FILE: {rel}")
        sections.append("-" * 60)

        if is_binary_file(file_path):
            sections.append("[BINARY FILE — conteúdo omitido, apenas listado na árvore]")
            binary_count += 1
        else:
            content = read_file_content(file_path)
            sections.append(content)
            file_count += 1

        sections.append("")

    # ── Rodapé ──
    sections.append("=" * 70)
    sections.append(f"Total de arquivos de texto: {file_count}")
    sections.append(f"Total de arquivos binários (omitidos): {binary_count}")
    sections.append("=" * 70)

    # ── Escreve ──
    output_path.write_text("\n".join(sections), encoding="utf-8")
    print(f"✅ Concluído!")
    print(f"   Arquivos de texto extraídos : {file_count}")
    print(f"   Arquivos binários (omitidos): {binary_count}")
    print(f"   Resultado salvo em          : {output_path}")


if __name__ == "__main__":
    main()