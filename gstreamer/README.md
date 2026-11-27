# GStreamer

Finds the GStreamer pipelines a process is running, those made before Luma
attached included, and draws the live graph of each on a page of its own:
bins around their elements, pads on the elements, and the negotiated caps on
every link.
Each bin, element, pad and link in the drawing is an object: click one and it
opens beside the graph, with its properties, its pads, what it is linked to,
and the way on to each of those.

The graph is GStreamer's own account of itself. The instrument asks the
library for the pipeline in Graphviz format, the same text
`GST_DEBUG_BIN_TO_DOT_FILE` writes, and Luma reads and draws it. It needs
Luma 4.0.0 or later.

## How it finds them

GStreamer keeps no list of its pipelines, so the instrument looks for them
two ways:

- **In memory, for what already exists.** A GObject begins with a pointer to
  its class. The instrument asks GObject for the class of `GstBin` and of
  every type derived from it, `GstPipeline`, `GstPlayBin3` and an
  application's own subclasses among them, and searches writable memory for
  pointers to those classes. Before a hit is treated as a bin it has to have a
  reference count that a live object could have, no parent, and a name that
  reads as one. A bin that was freed is not listed: GLib clears the class
  pointer when it frees an object.
- **By their state changes, for what comes later.** Every pipeline is set to
  a state before it does anything, so `gst_element_set_state` is hooked. From
  the element whose state is being set the instrument walks up to the
  top-level bin and lists it if it is new. This is the only hook; nothing on
  the path a buffer takes is touched.

Only top-level bins are listed, since the bins inside them are in their
graphs. One that is later added to another bin leaves the list, and so does
one that is freed.

A pipeline is never kept alive by being listed. Each is tracked through a
`GWeakRef`, and a strong reference is held only while its graph or its state
is being read.

## What it shows

- A status line at the top: whether GStreamer is loaded, its version and
  library, how much memory was searched and how long that took, and how many
  bins there are.
- **Pipelines**: a row per top-level bin, with its name, its type, whether it is
  a pipeline or a bare bin, its state, how many elements it holds at every
  depth, its address, and whether it was found by the memory scan or by a state
  change. Double-clicking a row, or selecting it and pressing Return, opens its
  page. **Rescan memory**, in the table's header, searches again. It is disabled
  until GStreamer is loaded, and while a search is under way. The table shows up
  to 10 rows and then scrolls.
- **Bins**, under the instrument in the sidebar: a page per top-level bin,
  named after it, with its type, element count and address beside the name
  and its state as a badge, green while playing and amber while paused or
  changing state. The page is the bin's graph, filling the window, and keeps
  its own camera, so switching between bins loses neither. A bin's page goes
  when the bin is freed or added to another bin. The pages are kept with the
  session; when the instrument starts again, those whose bin the first
  search of memory no longer finds are removed.

The graph is drawn left to right. A bin is a box around what it holds, as
deep as the pipeline goes; an element is a box with its type, name and state,
its sink pads on its left edge and its source pads on its right, each with its
activation mode and flags as GStreamer writes them. Sources are red, sinks
blue, and elements with both kinds of pad green, as in GStreamer's own
drawings. A ghost pad sits on its bin's border, joined by a dashed line to the
proxy pad just inside. Request pads have a dashed outline and sometimes-pads a
dotted one. Every link carries its media type and as many of its caps fields
as fit beside it, a long field wrapped after its name and at its commas, so
that the graph grows taller rather than wider. Drag or scroll to pan, pinch to
zoom, and press **f** to fit the whole graph; the camera stays where you put
it while the same pipeline is refreshed. Text on the canvas is ASCII: any
other character is drawn as `?`.

Everything else is reached by clicking. A bin, an element, a pad or a link
opens in a column beside the graph, and what it shows opens in the next:

- **The pipeline itself**, by clicking the outermost box away from what it
  holds, or the line at the top with its name, type and state: its children
  and properties, **Elements**, every element at every depth with its type,
  state, the bins it is inside and how many pads it has, **Links**, every
  pad-to-pad link with its media type, and **Dot**, the text GStreamer gave,
  to copy into Graphviz.
- **A bin**: its children, its pads, the elements it is linked to and its
  properties.
- **An element**: its pads, the elements it is linked to, its properties and
  the bin it is in.
- **A pad**: its caps, its peer and its element.
- **A link**: its caps and both of its pads.

A click on empty canvas clears the selection.

## Settings

- **Detail in the graph**: states and media types only; states, caps and the
  properties that differ from their defaults, which is the default and what
  `GST_DEBUG_GRAPH_SHOW_ALL` gives; or everything, with property values and
  caps in full rather than cut short.
- **Seconds between refreshes of the graphs**: 2 by default. Every bin's graph
  is taken again, and sent to its page only when it differs from the last
  one. At 0 a graph is taken when its bin is shown and when a state changes in
  it, and the table's rows are not refreshed on a timer.

## What it does not find

- **GStreamer linked statically into the program.** The instrument takes
  GStreamer's functions from the exports of whichever library has them,
  whatever that library is called. A program that exports none of them shows
  *GStreamer is not loaded*. When GStreamer is loaded later, the instrument
  notices and starts then.
- **A pipeline made after the scan that has not changed state yet.** It
  appears on its first `gst_element_set_state`, or on **Rescan memory**.
- **Elements that are in no bin.**

## Safety

The memory search reads and nothing else; a hit that does not check out is
dropped. On a bin that did, the instrument calls what an application would:
`g_weak_ref_init`, `gst_object_get_parent`, `gst_element_get_state` without
waiting, the child proxy functions to count elements, and
`gst_debug_bin_to_dot_data`, which takes the locks GStreamer's own dumps take
and reads every property it prints.

Two moments are worth knowing about. A bin freed in the instant between the
search's check and `g_weak_ref_init` would be written to after it was freed.
And if the program drops its last reference while the instrument is reading a
graph, the instrument's reference is the last, and the pipeline is finalized
on Frida's thread rather than the program's.

It was tested on macOS on Apple Silicon with GStreamer 1.28 from Homebrew,
against `gst-launch-1.0` pipelines, `playbin3` among them. Linux, Windows,
Android and 32-bit processes have not been tried.
