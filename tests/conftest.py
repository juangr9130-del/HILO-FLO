import sys
from pathlib import Path

# Permite correr pytest sin instalar el paquete.
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
