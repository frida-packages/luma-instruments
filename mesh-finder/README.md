# Mesh Finder

Finds the 3D meshes a game or app holds in its graphics buffers, so you can
browse them, turn them around in a 3D view, and take any of them home as an
OBJ file. Attach to a running game, add the instrument, and the meshes it has
loaded show up in a table: characters, props, level geometry, along with
whatever else the game draws.

It works with Metal and with desktop OpenGL on macOS. It needs Luma 3.0.0 or
later for its 3D view.

## How it finds them

Two ways, and both run at once:

- **From draw calls.** The draw calls tell exactly which buffers make up a
  mesh: the vertex buffer and the index buffer, where in them the mesh
  starts, how many indices it has, whether they are 16 or 32 bits wide,
  and whether it is a triangle list or strip. Where the API also says how
  the vertices are laid out, the positions are read exactly as the GPU
  reads them. A mesh drawn every frame is listed once.
- **From the buffers themselves.** Every vertex and index buffer the
  process holds is found, including those made before the instrument was
  added, and buffers that look like vertices are paired with buffers that
  look like indices whose largest index fits them. This finds meshes that
  are loaded but not on screen, such as the rest of a level. Each index
  buffer is tried against the 64 vertex buffers made nearest to it, and at
  most the 512 largest buffers left over are looked at as point clouds, so
  that a process with thousands of buffers is sorted through in seconds;
  until it is, the console says every two seconds how many buffers are
  left.

### Metal

Buffers are found by scanning the process's memory for instances of the GPU
driver's buffer classes, which takes well under a second even for a process
with gigabytes mapped. Draws are learned from the driver's render command
encoder: the vertex buffers, `setVertexBytes` data and index buffer bound for
each draw.

A pipeline state created after the instrument was added tells which vertex
attribute holds positions, from its `MTLVertexDescriptor` and the names of
its vertex function's inputs, such as `position`. These are read where the
driver initializes the pipeline. The synchronous creation calls were seen to
go through there; the asynchronous ones were not tried. For pipelines made
before that, and for shaders that fetch their own vertices with no vertex
descriptor, the layout is worked out from the bound buffers: their size, the
number of vertices the draw needs, and which bytes read as plausible
coordinates. The table says which of these it was.

Buffers in private storage have no contents the CPU can read. Meshes drawn
from them are still listed, with their triangle count, but there is nothing
to show or export.

### OpenGL

Draws are learned from `glDrawElements`, `glDrawArrays` and their ranged,
instanced and base-vertex variants. The vertex array state at the draw says
exactly where positions are, and the program's attribute names tell which
attribute they are in. Buffers are read back on the thread that draws, with
`glGetBufferSubData`, so buffers uploaded before the instrument was added are
read too. Buffers uploaded afterwards with `GL_STATIC_DRAW`, whether through
`glBufferData`, `glBufferSubData` or a mapping, are copied as they are
uploaded.

Live buffers are found by asking OpenGL which buffer names exist, on the next
frame the process draws.

## What it shows

**Meshes** has a row per mesh: its vertex and triangle counts, its size (the
extent of its bounding box), how its positions are laid out, what that was
learned from, and the buffers it lives in. A layout worked out rather than
declared by the API comes with a confidence.

- **Show** puts the mesh in the **Mesh** view below the table: drag to orbit,
  scroll or pinch to zoom, and pick Shaded, Wire or Points. A line under its
  title says what its layout was learned from. The console gets the details
  the picture does not show: its exact bounds and center, the layout and
  why, and the buffers. Meshes in GPU-only storage have nothing to show, and
  meshes whose positions and indices exceed the 64 MiB a view can be handed
  are refused; the console says which.
- **Export OBJ** writes the mesh to the console as a Wavefront OBJ, ready to
  copy into a file and open in any 3D tool. Point clouds are written as `p`
  elements. Meshes that would make more than 16 MiB of OBJ are refused.

The **Console** also takes commands: `show 3`, `obj 3`, `list`, and
`scan`, which looks for buffers again, such as after a new level has loaded.

The view keeps the last mesh shown with the session, so it is still there
when the project is opened again; the table is filled afresh each time the
instrument starts.

Strips and fans are turned into triangle lists, 16-bit indices are widened,
and only the vertices a mesh uses are kept, so a mesh that shares a large
buffer with others comes out on its own.

## Settings

- **Learn meshes from draw calls**: turn off to stop following Metal draws.
  OpenGL keeps its hooks, since buffers can only be read on the thread that
  draws, but stops learning meshes from them.
- **Guess meshes in buffers never drawn**: turn off to list only meshes seen
  drawn.
- **Lowest confidence shown for guessed meshes**: meshes found only in
  buffers, and never seen drawn, are shown from this confidence up. Buffers
  that look like vertices but have no index buffer to go with them are kept
  as point clouds at no more than 55%, so they are hidden unless you ask.
- **Fewest vertices a mesh must have**: hides the quads and other small
  shapes that every game draws for its interface.

## Cost

The hooks on the drawing thread do no more than remember which buffers are
bound and check whether a draw has been seen before. Only a draw not seen
before is looked at closely, once. In a test on an Apple Silicon Mac, 2100
Metal draws a frame took about 0.7 ms longer to encode with the instrument
than without, and 1800 OpenGL draws a frame about 3.4 ms longer to submit,
7.0 ms rather than 3.6 ms. A three.js scene in Chrome kept its 120 frames a
second, apart from a handful of frames of up to 70 ms while its meshes were
first read.

## What it does not find

- Meshes that are only ever drawn from buffers in private storage, or that
  are generated on the GPU, such as skinned meshes written by a compute
  shader.
- Positions that are not 32-bit floats, when they have to be guessed. A
  layout declared by the API is read in half floats and normalized integers
  too.
- Draws through Metal 4's `MTL4RenderCommandEncoder`, indirect command
  buffers and mesh shaders. Indirect draws are followed when their arguments
  are in CPU-visible memory, though this has not been tried.
- OpenGL client-side arrays and the fixed-function `glVertexPointer`, which
  older games use instead of buffer objects, and OpenGL draws issued through
  `CGLMacro.h` rather than the exported functions.
- The meshes Apple's OpenGL implementation draws through Metal on its own
  behalf are left out on purpose, so a game is not listed twice.
It was tested on macOS 27 on Apple Silicon. It has not been tried on Intel
Macs or on iOS.
