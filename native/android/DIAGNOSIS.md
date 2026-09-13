# Android implementation audit

The former renderer passed UV coordinates as normalized device coordinates, then flipped them again. Terrain sampling shadowed viewport height with a zero-valued local height, so every hit test used screen y=0. The origin was a forward hit rather than the player's ground projection. Missing depth was displayed as flat ground. Exceptions and tracking loss were hidden.

Replacement: camera NDC-to-texture conversion; gravity-aligned player origin anchored to detected ground; persistent depth-only terrain samples; unknown cells left empty; projected mesh, horizontal distance labels and downhill arrows; independent grid/heatmap controls and reset; explicit lifecycle/error handling.
