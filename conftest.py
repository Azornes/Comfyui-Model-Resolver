import os
import sys

# Add the parent directory of this custom node to sys.path so it can be imported as a package
parent_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if parent_dir not in sys.path:
    sys.path.insert(0, parent_dir)

# Tell pytest to ignore __init__.py during test collection
collect_ignore = ["__init__.py"]
