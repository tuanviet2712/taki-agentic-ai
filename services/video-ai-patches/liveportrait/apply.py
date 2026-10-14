"""TAKI patch for LivePortrait: use MediaPipe face detection instead of InsightFace (commercial-use safe).
Idempotent. Usage: python apply.py <LivePortrait dir>"""
import shutil
import sys
from pathlib import Path

root = Path(sys.argv[1])
here = Path(__file__).parent
shutil.copy(here / "face_analysis_mediapipe.py", root / "src/utils/face_analysis_mediapipe.py")
cropper = root / "src/utils/cropper.py"
text = cropper.read_text(encoding="utf-8")  # explicit: Windows defaults to cp1252
old = "from .face_analysis_diy import FaceAnalysisDIY"
new = "from .face_analysis_mediapipe import FaceAnalysisMediaPipe as FaceAnalysisDIY  # TAKI: MediaPipe (Apache-2.0) thay InsightFace (phi thương mại)"
if old in text:
    cropper.write_text(text.replace(old, new), encoding="utf-8")
    print("patched cropper.py")
elif new in text:
    print("cropper.py already patched")
else:
    sys.exit("cropper.py changed upstream — review the TAKI MediaPipe patch")
