# avatar.glb

Mixamo Y Bot, converted to GLB. Mixamo assets are free to use under Adobe's
Mixamo license terms: https://www.mixamo.com

The phone app doesn't use this file. The pose server serves it to the browser
viewer at `GET /viewer/avatar.glb` (see `fm_model/server/static/viewer.html`).
Bone names carry a `mixamorig:` prefix and a `_NN` suffix from the conversion;
the viewer strips both before matching.
