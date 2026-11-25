#include <CoreFoundation/CoreFoundation.h>
#include <jsi/jsi.h>
#ifdef JSI_HOST_JSC
#include <JSCRuntime.h>
#else
#include <hermes/hermes.h>
#endif
#include <pthread.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>

#include <fstream>
#include <memory>
#include <sstream>
#include <string>
#include <vector>

namespace jsi = facebook::jsi;

enum class Loop {
    Timer,
    Quiet,
    Idle,
    Churn,
};

struct Runtime {
    std::string name;
    Loop loop;
    std::string bundlePath;
    std::shared_ptr<jsi::Buffer> bundle;
};

static const double kTickSeconds = 0.02;
static const double kQuietTickSeconds = 4;
static const char *kReactNativeThreadName = "com.facebook.react.JavaScript";
static const int kChurnTicks = 250;

static void *runThread(void *data);
static std::unique_ptr<jsi::Runtime> makeRuntime();
static std::unique_ptr<jsi::Runtime> openRuntime(Runtime *runtime);
static void installHostFunctions(jsi::Runtime &rt, const std::string &name);
static void tick(CFRunLoopTimerRef timer, void *info);
static std::shared_ptr<jsi::Buffer> readFile(const std::string &path);
static Loop loopNamed(const std::string &name);
static const char *loopDescription(Loop loop);

struct TimerState {
    Runtime *runtime;
    std::unique_ptr<jsi::Runtime> rt;
    int ticks;
};

static void callTick(TimerState *state);

int main(int argc, char *argv[])
{
    if (argc < 3) {
        fprintf(stderr, "usage: %s <bundle> <name>:<timer|quiet|idle|churn>...\n", argv[0]);
        return 1;
    }
    std::shared_ptr<jsi::Buffer> bundle = readFile(argv[1]);
    std::vector<pthread_t> threads;
    printf("pid %d\n", getpid());
    fflush(stdout);
    for (int i = 2; i != argc; i++) {
        std::string spec(argv[i]);
        size_t colon = spec.find(':');
        Runtime *runtime = new Runtime{spec.substr(0, colon), loopNamed(spec.substr(colon + 1)), argv[1], bundle};
        pthread_t thread;
        pthread_create(&thread, nullptr, runThread, runtime);
        threads.push_back(thread);
    }
    for (pthread_t thread : threads) {
        pthread_join(thread, nullptr);
    }
    return 0;
}

static void *runThread(void *data)
{
    Runtime *runtime = static_cast<Runtime *>(data);
    std::string threadName = (runtime->loop == Loop::Idle) ? kReactNativeThreadName : "js-" + runtime->name;
    pthread_setname_np(threadName.c_str());
    TimerState *state = new TimerState{runtime, openRuntime(runtime), 0};
    printf("[%s] loop in %s on thread %s\n", runtime->name.c_str(), loopDescription(runtime->loop), threadName.c_str());
    fflush(stdout);
    if (runtime->loop != Loop::Idle) {
        CFRunLoopTimerContext context = {0, state, nullptr, nullptr, nullptr};
        double interval = (runtime->loop == Loop::Quiet) ? kQuietTickSeconds : kTickSeconds;
        CFRunLoopTimerRef timer = CFRunLoopTimerCreate(nullptr, CFAbsoluteTimeGetCurrent() + interval, interval, 0, 0, tick, &context);
        CFRunLoopAddTimer(CFRunLoopGetCurrent(), timer, kCFRunLoopDefaultMode);
    } else {
        CFRunLoopSourceContext context = {};
        CFRunLoopSourceRef keepAlive = CFRunLoopSourceCreate(nullptr, 0, &context);
        CFRunLoopAddSource(CFRunLoopGetCurrent(), keepAlive, kCFRunLoopDefaultMode);
    }
    CFRunLoopRun();
    return nullptr;
}

static std::unique_ptr<jsi::Runtime> openRuntime(Runtime *runtime)
{
    std::unique_ptr<jsi::Runtime> rt = makeRuntime();
    rt->global().setProperty(*rt, "hostName", jsi::String::createFromUtf8(*rt, runtime->name));
    installHostFunctions(*rt, runtime->name);
    rt->evaluateJavaScript(runtime->bundle, runtime->bundlePath);
    printf("[%s] runtime %p made\n", runtime->name.c_str(), static_cast<void *>(rt.get()));
    fflush(stdout);
    return rt;
}

static std::unique_ptr<jsi::Runtime> makeRuntime()
{
#ifdef JSI_HOST_JSC
    return facebook::jsc::makeJSCRuntime();
#else
    return facebook::hermes::makeHermesRuntime(::hermes::vm::RuntimeConfig::Builder().withMicrotaskQueue(true).build());
#endif
}

static void installHostFunctions(jsi::Runtime &rt, const std::string &name)
{
    auto report = [name](jsi::Runtime &rt, const jsi::Value &, const jsi::Value *args, size_t count) {
        std::string message = (count > 0) ? args[0].toString(rt).utf8(rt) : "";
        printf("[%s] %s\n", name.c_str(), message.c_str());
        fflush(stdout);
        return jsi::Value::undefined();
    };
    rt.global().setProperty(rt, "nativeReport",
        jsi::Function::createFromHostFunction(rt, jsi::PropNameID::forAscii(rt, "nativeReport"), 1, report));
    auto add = [](jsi::Runtime &rt, const jsi::Value &, const jsi::Value *args, size_t count) {
        double sum = 0;
        for (size_t i = 0; i != count; i++) {
            sum += args[i].asNumber();
        }
        return jsi::Value(sum);
    };
    rt.global().setProperty(rt, "nativeAdd",
        jsi::Function::createFromHostFunction(rt, jsi::PropNameID::forAscii(rt, "nativeAdd"), 2, add));
}

static void tick(CFRunLoopTimerRef timer, void *info)
{
    TimerState *state = static_cast<TimerState *>(info);
    callTick(state);
    if (state->runtime->loop == Loop::Churn && state->ticks == kChurnTicks) {
        printf("[%s] runtime %p closed\n", state->runtime->name.c_str(), static_cast<void *>(state->rt.get()));
        fflush(stdout);
        state->rt.reset();
        state->rt = openRuntime(state->runtime);
        state->ticks = 0;
    }
}

static void callTick(TimerState *state)
{
    jsi::Runtime &rt = *state->rt;
    jsi::Function tickFunction = rt.global().getPropertyAsFunction(rt, "tick");
    jsi::Value counter = tickFunction.call(rt, jsi::String::createFromAscii(rt, "from-native"));
    rt.drainMicrotasks();
    if (!counter.isNumber() || counter.asNumber() != ++state->ticks) {
        printf("[%s] CORRUPT tick returned %s after %d ticks\n", state->runtime->name.c_str(), counter.toString(rt).utf8(rt).c_str(), state->ticks);
        fflush(stdout);
    }
}

static std::shared_ptr<jsi::Buffer> readFile(const std::string &path)
{
    std::ifstream file(path, std::ios::binary);
    std::stringstream contents;
    contents << file.rdbuf();
    return std::make_shared<jsi::StringBuffer>(contents.str());
}

static Loop loopNamed(const std::string &name)
{
    if (name == "quiet") {
        return Loop::Quiet;
    }
    if (name == "idle") {
        return Loop::Idle;
    }
    if (name == "churn") {
        return Loop::Churn;
    }
    return Loop::Timer;
}

static const char *loopDescription(Loop loop)
{
    switch (loop) {
        case Loop::Timer:
            return "a run loop timer";
        case Loop::Quiet:
            return "a run loop timer that fires every few seconds";
        case Loop::Idle:
            return "an idle run loop";
        case Loop::Churn:
            return "a run loop timer, closing and reopening";
    }
}
