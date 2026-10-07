from fmpose3d import FMPose3DInference

api = FMPose3DInference()  # human model; weights download on first run
result = api.predict("../photos/skateboarder.png")

print(result.poses_3d.shape)  # (1, 17, 3)
print(result.poses_3d_world)  # the 3D joint coordinates

import matplotlib.pyplot as plt

pose = result.poses_3d_world[0]
parents = [-1, 0, 1, 2, 0, 4, 5, 0, 7, 8, 9, 8, 11, 12, 8, 14, 15]
ax = plt.figure().add_subplot(projection="3d")
for j, p in enumerate(parents):
    if p >= 0:
        ax.plot(*zip(pose[j], pose[p]), "o-")
plt.show()
