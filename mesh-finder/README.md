# Mesh Finder

Finds the 3D meshes a game or app holds in its graphics buffers, so you can
browse them, turn them around in a 3D view, and take any of them home as an
OBJ file. Attach to a running game, add the instrument, and the meshes it has
loaded show up in a table: characters, props, level geometry, along with
whatever else the game draws.

It works with Metal and with desktop OpenGL on macOS, and with Vulkan,
desktop OpenGL and OpenGL ES on Linux. It needs Luma 3.0.0 or later for its
3D view.

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
  added (with Vulkan, only some of those: see below), and buffers that look
  like vertices are paired with buffers that look like indices whose
  largest index fits them. This finds meshes that are loaded but not on
  screen, such as the rest of a level. Each index buffer is tried against
  the 64 vertex buffers made nearest to it, and at most the 512 largest
  buffers left over are looked at as point clouds, so that a process with
  thousands of buffers is sorted through in seconds; until it is, the
  console says every two seconds how many buffers are left.

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

On Linux, a game may call OpenGL through `libGL`, `libOpenGL` or `libGLESv2`,
or through pointers it got from `eglGetProcAddress` or `glXGetProcAddressARB`,
as loaders such as glad do, and these are different functions that each lead
into the driver. Mesh Finder hooks all of them, including those of libraries
loaded after it was added. The current EGL or GLX context tells draws apart.
OpenGL ES contexts are read back with `glMapBufferRange`, since they have no
`glGetBufferSubData`, and their meshes are listed as OpenGL ES. Contexts that
share their objects are told apart all the same, so a buffer uploaded in one
and drawn in another may be listed twice.

### Vulkan

Draws are learned from the driver's own functions, so they are seen however
the game reached them: through the Vulkan loader, through
`vkGetDeviceProcAddr` and libraries such as volk, or beneath layers. To find
those functions, Mesh Finder makes a small instance and device of its own on
each driver loaded in the process, asks it for them, and destroys it again.
Commands are seen as they are recorded: the pipeline, vertex buffers, index
buffer and vertex input bound for each `vkCmdDraw` and `vkCmdDrawIndexed`,
including the multi-draw and indirect ones.

A pipeline made after the instrument was added tells where positions are,
from its vertex input state and from the names its vertex shader gives its
inputs, such as `inPosition`, when the SPIR-V keeps them. Pipelines linked
from graphics pipeline libraries are followed. With
`VK_EXT_vertex_input_dynamic_state`, the layout is taken from
`vkCmdSetVertexInputEXT` at each draw, however old the pipeline is, and
strides set with `vkCmdBindVertexBuffers2` are used too. Otherwise the layout
is worked out from the buffers, as for Metal. The topology of a pipeline made
before the instrument was added is unknown, so its draws are taken to be
triangle lists, or strips when their vertex count cannot be a list.

A Vulkan buffer is a handle, not an object that can be found in memory, so
its contents are known only from what Mesh Finder sees happen to it. Memory
allocated and mapped after the instrument was added is read where it is
mapped, and copied when it is unmapped. Copies from such memory into
device-local buffers, with `vkCmdCopyBuffer` and `vkCmdCopyBuffer2`, are
copied when their command buffer is submitted, as is data written with
`vkCmdUpdateBuffer`. So a level loaded after the instrument was added comes
out whole, staged into device-local memory or not.

What was set up before the instrument was added is mostly out of reach.
Meshes drawn from buffers bound to memory before then are listed with their
triangle count, and their vertex count when they are not indexed, but have no
contents to show or export. Memory that was mapped before and still is, as
engines often keep it, is found among the process's GPU mappings on Linux,
and searched for meshes like buffers never drawn. Which buffers that memory
holds is not known, so such a mesh may also appear as a draw with no
contents. Engines that keep meshes in large buffers they set up at start,
ANGLE among them, put even meshes uploaded later in memory Mesh Finder never
saw mapped.

## What it shows

**Meshes** has a row per mesh: its vertex and triangle counts, its size (the
extent of its bounding box), how its positions are laid out, what that was
learned from, and the buffers it lives in. A layout worked out rather than
declared by the API comes with a confidence.

- **Show** puts the mesh in the **Mesh** view below the table: drag to orbit,
  scroll or pinch to zoom, and pick Shaded, Wire or Points. A line under its
  title says what its layout was learned from. The console gets the details
  the picture does not show: its exact bounds and center, the layout and
  why, and the buffers. Meshes with no CPU contents, because they are in
  GPU-only storage or, with Vulkan, were bound to memory before the
  instrument was added, have nothing to show, and meshes whose positions and
  indices exceed the 64 MiB a view can be handed are refused; the console
  says which.
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
  draws, and so does Vulkan, since its buffers are only known from them, but
  both stop learning meshes from draws.
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
first read. On a Core i9-12900K with Intel's Mesa driver, 1800 Vulkan draws a
frame took 1.6 ms longer to record, about 0.9 µs a draw with five Vulkan
calls each, and 1800 OpenGL or OpenGL ES draws a frame 1 ms longer to submit.

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
- The contents of Vulkan buffers bound to memory before the instrument was
  added, except where that memory is still mapped. Vulkan indirect draws
  whose counts come from a buffer, mesh shaders, device-generated commands,
  and Vulkan in 32-bit processes.

It was tested on macOS 27 on Apple Silicon, and on x86_64 Linux with Mesa 26
on Intel graphics: Vulkan, and desktop OpenGL and OpenGL ES through EGL, both
in test programs and in Chromium drawing WebGL through ANGLE's Vulkan and
OpenGL backends. It has not been tried on Intel Macs, iOS, Windows or
Android, with GLX, or with other drivers.
