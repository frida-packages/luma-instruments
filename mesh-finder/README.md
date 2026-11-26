# Mesh Finder

Finds the 3D meshes a game or app holds in its graphics buffers, so you can
browse them, turn them around in a 3D view, and take any of them home as an
OBJ file. Attach to a running game, add the instrument, and the meshes it has
loaded show up in a table: characters, props, level geometry, along with
whatever else the game draws.

It works with Direct3D 11 on Windows, with Metal and desktop OpenGL on
macOS, and with Vulkan, desktop OpenGL and OpenGL ES on Linux. It needs Luma
4.0.0 or later.

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

### Direct3D 11

Draws are learned from the device context: the input layout, vertex buffers,
index buffer and topology bound for each `Draw`, `DrawIndexed`, their
instanced variants and their indirect ones, whose arguments are read from
their buffer. This covers deferred contexts too, with their command lists
read when the immediate context runs. An input layout created after the
instrument was added says exactly where positions are, by their `POSITION`
element, in floats, half floats or normalized integers. For input layouts
made before that, the layout is worked out from the bound buffers, as for
Metal.

Buffers are read back on the thread that draws, by copying them on the
immediate context into a staging buffer, so every buffer can be read, the
immutable ones too, and those made before the instrument was added. Live
buffers are found by scanning the process's memory for instances of
`d3d11.dll`'s buffer class, and freed ones are told apart and left alone.
Buffers created afterwards are read once they have settled. Each buffer's
debug name, where the game set one, is its label.

To learn `d3d11.dll`'s classes, the instrument makes a Direct3D 11 device of
its own when it starts, without rendering, and lets it go again. Calls into
`d3d11.dll` are hooked where they are implemented, rather than in each
context's function table, since a context switches between tables as it
runs.

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

Metal binds a draw's vertices and its uniforms through the same table, and
for such a pipeline nothing says which is which. A game typically writes its
uniforms, and often the indices and vertices of what it batches, into scratch
buffers that it rewrites every frame, and uniforms read as plausible
coordinates too. So Mesh Finder watches the bytes at each place a draw binds.
A place counts only once the same bytes were seen there in an earlier render
pass, in a buffer that has kept still for a few dozen passes. A buffer whose
bytes keep changing is taken for scratch from then on, and what was listed
from it is removed. Among the places that count, vertices
are looked for in the ones bound last, since what an earlier draw left bound
was bound before; a slot where an earlier guess found a pipeline's vertices
is remembered as theirs. Indices in a scratch buffer are told apart by what
they say rather than where they are, so a mesh that is batched anew every
frame is listed once.

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
triangle lists, or strips when their vertex count cannot be a list. Once a
pipeline is made again, the draws that use it are looked at again, even when
the new pipeline has the old one's handle.

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

- **Show** puts the mesh in the **Mesh** view below the table, beside the
  console: drag to orbit, scroll or pinch to zoom, and pick Shaded, Wire or
  Points. A line under its title says what its layout was learned from. The
  console gets the details the picture does not show: its exact bounds and
  center, the layout and why, and the buffers. Meshes with no CPU contents,
  because they are in GPU-only storage or, with Vulkan, were bound to memory
  before the instrument was added, have nothing to show, and meshes whose
  positions and indices exceed the 64 MiB a view can be handed are refused;
  the console says which. In a narrow window the console goes below the
  view, the table shows 6 rows, and the page scrolls.
- **Export OBJ** offers the mesh as a Wavefront OBJ file, ready to open in any
  3D tool, and Luma asks where to save it. The file is named after the mesh as
  the table names it, such as `#3 Cube vertices.obj`, with characters a file
  name cannot have, such as `/` and `:`, made `-`. Point clouds are written as
  `p` elements. Meshes that would make more than 64 MiB of OBJ are refused,
  and the console says so.

**Scan**, in the table's header, looks for buffers again, such as after a new
level has loaded. It is disabled while a search is under way, and while
**Guess meshes in buffers never drawn** is off, since buffers are then only
learned from draws. An OpenGL or Direct3D 11 search reads the buffers on the
thread that draws, the next time it does, and gives up after 3 seconds when
it does not.

The **Console** also takes commands: `show 3`, `obj 3`, which does what
**Export OBJ** does, `list`, and `scan`, which does what **Scan** does, or says
why it cannot.
**Clear**, in its header, empties it.

The view keeps the last mesh shown with the session, so it is still there
when the project is opened again; the table is filled afresh each time the
instrument starts.

Strips and fans are turned into triangle lists, 16-bit indices are widened,
and only the vertices a mesh uses are kept, so a mesh that shares a large
buffer with others comes out on its own.

## Settings

- **Learn meshes from draw calls**: turn off to stop following Metal draws.
  Direct3D 11 and OpenGL keep their hooks, since buffers can only be read on
  the thread that draws, and so does Vulkan, since its buffers are only known
  from them, but all three stop learning meshes from draws.
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
On Windows 11, with Direct3D 11's software rasterizer in a virtual machine,
1800 draws a frame took about 1.9 ms longer to submit, which is about 1 µs a
draw with the calls that set up its buffers. The first frame after the
instrument is added, when every mesh is read, took up to 160 ms.
In a process holding 4000 vertex buffers, they were found and read 512 a
frame, no frame took longer than 232 ms while they were, and guessing which
of them are meshes took about 20 s.

## What it does not find

- Meshes that are only ever drawn from buffers in private storage, or that
  are generated on the GPU, such as skinned meshes written by a compute
  shader.
- Positions that are not 32-bit floats, when they have to be guessed. A
  layout declared by the API is read in half floats and normalized integers
  too.
- Metal meshes whose vertices are rewritten every frame, as dynamically
  batched geometry, particles and most user interfaces are.
- Direct3D 11 draws whose input layout was made before the instrument was
  added have their layout guessed, since an input layout keeps no names.
  Draws that fetch their own vertices from shader resources, stream output
  (`DrawAuto`), and meshes generated on the GPU are not followed.
- Direct3D 9, 10 and 12, and Direct3D 11 running on top of 12 through
  `D3D11On12`.
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

It was tested on macOS 27 on Apple Silicon; on x86_64 Linux with Mesa 26
on Intel graphics: Vulkan, and desktop OpenGL and OpenGL ES through EGL, both
in test programs and in Chromium drawing WebGL through ANGLE's Vulkan and
OpenGL backends; and on Windows 11 25H2, 64-bit and 32-bit, with the WARP
software rasterizer and the Microsoft Basic Render Driver. It has not been
tried on Intel Macs, iOS, other versions of Windows or Android, with GLX,
with a GPU vendor's Direct3D driver, with the Direct3D debug layer, or with
other drivers.
