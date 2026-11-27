#import <JavaScriptCore/JavaScriptCore.h>
#import <WebKit/WebKit.h>
#include <pthread.h>
#include <stdio.h>
#include <string.h>

typedef struct OpaqueJSScript * JSScriptRef;

extern JSScriptRef JSScriptCreateFromString (JSContextGroupRef group, JSStringRef url, int starting_line_number,
    JSStringRef source, JSStringRef * error_message, int * error_line);
extern JSValueRef JSScriptEvaluate (JSContextRef context, JSScriptRef script, JSValueRef this_value, JSValueRef * exception);

static void *
run_worker (void * unused)
{
  pthread_setname_np ("js-worker");
  @autoreleasepool
  {
    JSContext * context = [JSContext new];
    context.name = @"worker";
    [context evaluateScript:@"var ticks = 0;\n"
                             "function busy () { let sum = 0; for (let i = 0; i !== 20000; i++) { sum += Math.sqrt(i); } return sum; }\n"
                             "function tick () { busy(); return ++ticks; }\n"
              withSourceURL:[NSURL URLWithString:@"app://worker.js"]];
    for (;;)
    {
      @autoreleasepool
      {
        [context evaluateScript:@"tick()"];
      }
      usleep (5000);
    }
  }
  return NULL;
}

static void *
run_churn (void * unused)
{
  pthread_setname_np ("js-churn");
  for (;;)
  {
    JSGlobalContextRef context = JSGlobalContextCreate (NULL);
    JSStringRef name = JSStringCreateWithUTF8CString ("short-lived");
    JSGlobalContextSetName (context, name);
    JSStringRelease (name);
    JSGlobalContextRelease (context);
    JSGarbageCollect (NULL);
    sleep (1);
  }
  return NULL;
}

static void
run_scripts (JSGlobalContextRef context)
{
  JSStringRef url = JSStringCreateWithUTF8CString ("app://script-api.js");
  JSStringRef source = JSStringCreateWithUTF8CString ("var scripted = (typeof scripted === 'number') ? scripted + 1 : 1;");
  JSScriptRef script = JSScriptCreateFromString (JSContextGetGroup (context), url, 1, source, NULL, NULL);
  JSStringRelease (url);
  JSStringRelease (source);
  [NSTimer scheduledTimerWithTimeInterval:0.5 repeats:YES block:^(NSTimer * timer) {
    JSScriptEvaluate (context, script, NULL, NULL);
  }];
}

int
main (int argc, char * argv[])
{
  @autoreleasepool
  {
    JSGlobalContextRef plain = JSGlobalContextCreate (NULL);
    JSGlobalContextRef sibling = JSGlobalContextCreateInGroup (JSContextGetGroup (plain), NULL);
    JSStringRef name = JSStringCreateWithUTF8CString ("sibling");
    JSGlobalContextSetName (sibling, name);
    JSStringRelease (name);

    JSContext * objc = [JSContext new];
    objc.name = @"objc";
    objc[@"nativeAdd"] = ^(int a, int b) { return a + b; };
    [objc evaluateScript:@"var marker = 1; var later = { resolve: null };\n"
                          "function waitLater () { return new Promise(resolve => { later.resolve = resolve; }); }\n"
           withSourceURL:[NSURL URLWithString:@"app://main.js"]];
    [NSTimer scheduledTimerWithTimeInterval:0.25 repeats:YES block:^(NSTimer * timer) {
      [objc evaluateScript:@"if (later.resolve !== null) { later.resolve(marker * 7); later.resolve = null; }"];
    }];

    run_scripts (sibling);

    WebView * web = nil;
    if (argc > 1 && strcmp (argv[1], "web") == 0)
    {
      web = [[WebView alloc] initWithFrame:NSMakeRect (0, 0, 320, 240)];
      [[web mainFrame] loadHTMLString:@"<html><head><title>Luma test page</title></head>"
                                       "<body><script>var pageMarker = 42;</script></body></html>"
                              baseURL:[NSURL URLWithString:@"https://luma.test/page.html"]];
    }

    pthread_t worker, churn;
    pthread_create (&worker, NULL, run_worker, NULL);
    pthread_create (&churn, NULL, run_churn, NULL);

    printf ("plain=%p sibling=%p objc=%p\n", plain, sibling, objc.JSGlobalContextRef);
    fflush (stdout);

    [[NSRunLoop mainRunLoop] run];
  }
  return 0;
}
