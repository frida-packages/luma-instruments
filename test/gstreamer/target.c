#include <glib-unix.h>
#include <gst/gst.h>
#include <signal.h>
#include <stdio.h>

#define TEST_TYPE_APP_PIPELINE (test_app_pipeline_get_type ())
G_DECLARE_FINAL_TYPE (TestAppPipeline, test_app_pipeline, TEST, APP_PIPELINE, GstPipeline)

struct _TestAppPipeline
{
  GstPipeline parent;
};

G_DEFINE_TYPE (TestAppPipeline, test_app_pipeline, GST_TYPE_PIPELINE)

const char gstreamer_expectations[] =
  "["
  "{\"name\":\"tee-pipeline\",\"type\":\"GstPipeline\",\"kind\":\"pipeline\",\"state\":\"playing\",\"elements\":7,"
  "\"presence\":\"listed\",\"foundBy\":\"memory scan\","
  "\"children\":[\"source\",\"splitter\",\"left-queue\",\"left-sink\",\"right-queue\",\"right-sink\"]},"
  "{\"name\":\"nested-pipeline\",\"type\":\"GstPipeline\",\"kind\":\"pipeline\",\"state\":\"playing\",\"elements\":7,"
  "\"presence\":\"listed\",\"foundBy\":\"memory scan\","
  "\"children\":[\"tone\",\"filter-bin\",\"converter\",\"gain\",\"inner-bin\",\"inner-queue\",\"audio-sink\"]},"
  "{\"name\":\"app-pipeline\",\"type\":\"TestAppPipeline\",\"kind\":\"pipeline\",\"state\":\"paused\",\"elements\":4,"
  "\"presence\":\"until-signal\",\"foundBy\":\"memory scan\","
  "\"children\":[\"app-source\",\"app-sink\",\"spare-bin\",\"spare-identity\"]},"
  "{\"name\":\"spare-bin\",\"type\":\"GstBin\",\"kind\":\"bin\",\"state\":\"null\",\"elements\":1,"
  "\"presence\":\"absent\",\"foundBy\":\"\",\"children\":[]},"
  "{\"name\":\"adopted-bin\",\"type\":\"GstBin\",\"kind\":\"bin\",\"state\":\"null\",\"elements\":1,"
  "\"presence\":\"until-signal\",\"foundBy\":\"memory scan\",\"children\":[\"adopted-identity\"]},"
  "{\"name\":\"lonely-bin\",\"type\":\"GstBin\",\"kind\":\"bin\",\"state\":\"null\",\"elements\":1,"
  "\"presence\":\"listed\",\"foundBy\":\"memory scan\",\"children\":[\"lonely-identity\"]},"
  "{\"name\":\"freed-pipeline\",\"type\":\"GstPipeline\",\"kind\":\"pipeline\",\"state\":\"null\",\"elements\":2,"
  "\"presence\":\"absent\",\"foundBy\":\"\",\"children\":[]},"
  "{\"name\":\"late-pipeline\",\"type\":\"GstPipeline\",\"kind\":\"pipeline\",\"state\":\"playing\",\"elements\":4,"
  "\"presence\":\"after-signal\",\"foundBy\":\"state change\","
  "\"children\":[\"late-tone\",\"late-sink\",\"adopted-bin\",\"adopted-identity\"]}"
  "]";

static GMainLoop * loop;
static GPtrArray * held;
static guint created;
static guint finalized;

static void test_app_pipeline_class_init (TestAppPipelineClass * klass) {}
static void test_app_pipeline_init (TestAppPipeline * self) {}

static void
count_finalization (gpointer name, GObject * where_the_object_was)
{
  finalized++;
  printf ("finalized %s\n", (const char *) name);
  fflush (stdout);
}

static GstElement *
watched (GstElement * bin)
{
  created++;
  g_object_weak_ref (G_OBJECT (bin), count_finalization, g_strdup (GST_OBJECT_NAME (bin)));
  return bin;
}

static void
play (GstElement * pipeline, GstState state)
{
  gst_element_set_state (pipeline, state);
  gst_element_get_state (pipeline, NULL, NULL, GST_CLOCK_TIME_NONE);
}

static GstElement *
make_tee_pipeline (void)
{
  GstElement * pipeline = gst_parse_launch (
      "videotestsrc name=source is-live=true "
      "! video/x-raw,format=I420,width=160,height=120,framerate=15/1,pixel-aspect-ratio=1/1 "
      "! tee name=splitter "
      "! queue name=left-queue ! fakesink name=left-sink sync=true "
      "splitter. ! queue name=right-queue ! fakesink name=right-sink sync=true",
      NULL);
  gst_object_set_name (GST_OBJECT (pipeline), "tee-pipeline");
  return watched (pipeline);
}

static GstElement *
make_nested_pipeline (void)
{
  GstElement * pipeline = gst_pipeline_new ("nested-pipeline");
  GstElement * tone = gst_element_factory_make_full ("audiotestsrc", "name", "tone", "is-live", TRUE, NULL);
  GstElement * filter_bin = gst_bin_new ("filter-bin");
  GstElement * converter = gst_element_factory_make ("audioconvert", "converter");
  GstElement * gain = gst_element_factory_make_full ("volume", "name", "gain", "volume", 0.5, NULL);
  GstElement * inner_bin = gst_bin_new ("inner-bin");
  GstElement * inner_queue = gst_element_factory_make ("queue", "inner-queue");
  GstElement * sink = gst_element_factory_make_full ("fakesink", "name", "audio-sink", "sync", TRUE, NULL);

  gst_bin_add (GST_BIN (inner_bin), inner_queue);
  gst_element_add_pad (inner_bin, gst_ghost_pad_new ("sink", gst_element_get_static_pad (inner_queue, "sink")));
  gst_element_add_pad (inner_bin, gst_ghost_pad_new ("src", gst_element_get_static_pad (inner_queue, "src")));

  gst_bin_add_many (GST_BIN (filter_bin), converter, gain, inner_bin, NULL);
  gst_element_link_many (converter, gain, inner_bin, NULL);
  gst_element_add_pad (filter_bin, gst_ghost_pad_new ("sink", gst_element_get_static_pad (converter, "sink")));
  gst_element_add_pad (filter_bin, gst_ghost_pad_new ("src", gst_element_get_static_pad (inner_bin, "src")));

  gst_bin_add_many (GST_BIN (pipeline), tone, filter_bin, sink, NULL);
  gst_element_link_many (tone, filter_bin, sink, NULL);
  return watched (pipeline);
}

static GstElement * make_parentless_bin (const char * name, const char * identity_name);

static GstElement *
make_app_pipeline (void)
{
  GstElement * pipeline = g_object_new (TEST_TYPE_APP_PIPELINE, "name", "app-pipeline", NULL);
  GstElement * source = gst_element_factory_make ("fakesrc", "app-source");
  GstElement * sink = gst_element_factory_make_full ("fakesink", "name", "app-sink", "sync", TRUE, NULL);
  gst_bin_add_many (GST_BIN (pipeline), source, sink, make_parentless_bin ("spare-bin", "spare-identity"), NULL);
  gst_element_link (source, sink);
  return watched (pipeline);
}

static GstElement *
make_parentless_bin (const char * name, const char * identity_name)
{
  GstElement * bin = gst_bin_new (name);
  gst_bin_add (GST_BIN (bin), gst_element_factory_make ("identity", identity_name));
  return watched (bin);
}

static GstElement *
make_simple_pipeline (const char * name, const char * source_name, const char * sink_name)
{
  GstElement * pipeline = gst_pipeline_new (name);
  GstElement * source = gst_element_factory_make_full ("audiotestsrc", "name", source_name, "is-live", TRUE, NULL);
  GstElement * sink = gst_element_factory_make_full ("fakesink", "name", sink_name, "sync", TRUE, NULL);
  gst_bin_add_many (GST_BIN (pipeline), source, sink, NULL);
  gst_element_link (source, sink);
  return watched (pipeline);
}

static void
release (GstElement * bin)
{
  play (bin, GST_STATE_NULL);
  g_ptr_array_remove (held, bin);
  gst_object_unref (bin);
}

static GstElement *
held_bin_named (const char * name)
{
  for (guint i = 0; i != held->len; i++)
  {
    GstElement * bin = g_ptr_array_index (held, i);
    if (g_strcmp0 (GST_OBJECT_NAME (bin), name) == 0)
      return bin;
  }
  return NULL;
}

static void
drop_child (GstElement * parent, const char * name)
{
  GstElement * child = gst_bin_get_by_name (GST_BIN (parent), name);
  gst_bin_remove (GST_BIN (parent), child);
  gst_element_set_state (child, GST_STATE_NULL);
  gst_object_unref (child);
}

static void
adopt (GstElement * parent, GstElement * bin)
{
  gst_bin_add (GST_BIN (parent), bin);
  g_ptr_array_remove (held, bin);
  gst_object_unref (bin);
}

static gboolean
on_change_requested (gpointer data)
{
  GstElement * late = make_simple_pipeline ("late-pipeline", "late-tone", "late-sink");
  g_ptr_array_add (held, late);
  adopt (late, held_bin_named ("adopted-bin"));
  play (late, GST_STATE_PLAYING);
  GstElement * app = held_bin_named ("app-pipeline");
  drop_child (app, "spare-bin");
  release (app);
  printf ("changed: late-pipeline playing with adopted-bin, spare-bin dropped, app-pipeline released\n");
  fflush (stdout);
  return G_SOURCE_CONTINUE;
}

static gboolean
on_teardown_requested (gpointer data)
{
  while (held->len != 0)
    release (g_ptr_array_index (held, 0));
  g_main_loop_quit (loop);
  return G_SOURCE_REMOVE;
}

int
main (int argc, char * argv[])
{
  gst_init (&argc, &argv);
  held = g_ptr_array_new ();

  GstElement * freed = make_simple_pipeline ("freed-pipeline", "freed-tone", "freed-sink");
  play (freed, GST_STATE_PLAYING);
  play (freed, GST_STATE_NULL);
  gst_object_unref (freed);

  g_ptr_array_add (held, make_tee_pipeline ());
  g_ptr_array_add (held, make_nested_pipeline ());
  g_ptr_array_add (held, make_app_pipeline ());
  g_ptr_array_add (held, gst_object_ref_sink (make_parentless_bin ("lonely-bin", "lonely-identity")));
  g_ptr_array_add (held, gst_object_ref_sink (make_parentless_bin ("adopted-bin", "adopted-identity")));
  play (held_bin_named ("tee-pipeline"), GST_STATE_PLAYING);
  play (held_bin_named ("nested-pipeline"), GST_STATE_PLAYING);
  play (held_bin_named ("app-pipeline"), GST_STATE_PAUSED);

  loop = g_main_loop_new (NULL, FALSE);
  g_unix_signal_add (SIGUSR1, on_change_requested, NULL);
  g_unix_signal_add (SIGUSR2, on_teardown_requested, NULL);
  printf ("ready, %u of %u bins finalized\n", finalized, created);
  fflush (stdout);
  g_main_loop_run (loop);

  guint lingering = created - finalized;
  printf ("torn down: %u of %u bins finalized\n", finalized, created);
  return (lingering == 0) ? 0 : 1;
}
