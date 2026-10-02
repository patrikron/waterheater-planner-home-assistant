import json
import sys
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
FIXTURES = Path(__file__).parent / "fixtures"

# The pure modules (planner, engine, solar, price_sensor, model) never import Home Assistant, so the tests
# run without it. Register the package as a bare namespace so its `__init__.py` (which does import
# Home Assistant) is not executed.
_pkg_dir = ROOT / "custom_components" / "waterheater_planner"
for _name, _path in (("custom_components", ROOT / "custom_components"), ("custom_components.waterheater_planner", _pkg_dir)):
    _module = types.ModuleType(_name)
    _module.__path__ = [str(_path)]
    sys.modules.setdefault(_name, _module)


def load_fixture(name):
    return json.loads((FIXTURES / name).read_text())
