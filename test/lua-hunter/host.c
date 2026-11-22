#include <lauxlib.h>
#include <lua.h>
#include <lualib.h>
#include <pthread.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>

#ifndef LUA_OK
#define LUA_OK 0
#endif

typedef enum {
    LOOP_IN_C,
    LOOP_IN_LUA,
    LOOP_BUSY,
    LOOP_IDLE,
    LOOP_CHURN,
} LoopKind;

typedef struct {
    const char *name;
    LoopKind loop;
} Interpreter;

static const char *script =
    "counter = 0\n"
    "ticks_expected = 0\n"
    "config = { speed = 3, name = host_name, tags = { 'red', 'green' }, nested = { deeper = { deepest = { 1, 2 } } } }\n"
    "local seen_marker = nil\n"
    "function tick()\n"
    "  counter = counter + 1\n"
    "  ticks_expected = ticks_expected + 1\n"
    "  if counter ~= ticks_expected then report('CORRUPT counter ' .. tostring(counter)) end\n"
    "  if marker ~= seen_marker then\n"
    "    seen_marker = marker\n"
    "    report('observed marker = ' .. tostring(marker))\n"
    "  end\n"
    "  local garbage = {}\n"
    "  for i = 1, 64 do garbage[i] = tostring(i) .. host_name end\n"
    "  checksum = (checksum or 0) + #garbage\n"
    "end\n";

static const char *lua_loop = "while true do tick() sleep_ms(20) end";

static const char *loop_names[] = { "C", "Lua", "C, busy", "nothing, idle", "C, closing and reopening" };

#define CHURN_TICKS 50

static void allocate_ballast(void);
static LoopKind loop_kind_named(const char *name);
static void *run_interpreter(void *data);
static lua_State *open_interpreter(Interpreter *interpreter);
static int report(lua_State *L);
static int sleep_ms(lua_State *L);
static void run_c_loop(lua_State *L, const char *name);
static void run_busy_loop(lua_State *L, const char *name);
static void run_ticks(lua_State *L, const char *name, int count);
static void fail(lua_State *L, const char *what);

int main(int argc, char *argv[])
{
    int count = argc - 1;
    pthread_t *threads = calloc(count, sizeof(pthread_t));
    Interpreter *interpreters = calloc(count, sizeof(Interpreter));
    int i;

    printf("pid %d\n", getpid());
    fflush(stdout);
    allocate_ballast();
    for (i = 0; i != count; i++) {
        char *spec = strdup(argv[i + 1]);
        char *colon = strchr(spec, ':');
        interpreters[i].loop = LOOP_IN_C;
        if (colon != NULL) {
            *colon = '\0';
            interpreters[i].loop = loop_kind_named(colon + 1);
        }
        interpreters[i].name = spec;
        pthread_create(&threads[i], NULL, run_interpreter, &interpreters[i]);
    }
    for (i = 0; i != count; i++) {
        pthread_join(threads[i], NULL);
    }
    return 0;
}

static void allocate_ballast(void)
{
    const char *megabytes = getenv("LUA_HUNTER_BALLAST_MB");
    size_t chunk_size = 1024 * 1024;
    void **previous = NULL;
    long count, i;
    size_t j;

    if (megabytes == NULL) {
        return;
    }
    count = atol(megabytes);
    for (i = 0; i != count; i++) {
        void **chunk = malloc(chunk_size);
        for (j = 0; j != chunk_size / sizeof(void *); j++) {
            chunk[j] = (j % 2 == 0) ? (void *) previous : (void *) (chunk + j);
        }
        previous = chunk;
    }
    printf("ballast %ld MiB\n", count);
    fflush(stdout);
}

static LoopKind loop_kind_named(const char *name)
{
    if (strcmp(name, "lua") == 0) {
        return LOOP_IN_LUA;
    }
    if (strcmp(name, "busy") == 0) {
        return LOOP_BUSY;
    }
    if (strcmp(name, "idle") == 0) {
        return LOOP_IDLE;
    }
    if (strcmp(name, "churn") == 0) {
        return LOOP_CHURN;
    }
    return LOOP_IN_C;
}

static void *run_interpreter(void *data)
{
    Interpreter *interpreter = data;
    lua_State *L = open_interpreter(interpreter);

    switch (interpreter->loop) {
        case LOOP_IN_C:
            run_c_loop(L, interpreter->name);
            break;
        case LOOP_IN_LUA:
            if (luaL_dostring(L, lua_loop) != LUA_OK) {
                fail(L, "loop");
            }
            break;
        case LOOP_BUSY:
            run_busy_loop(L, interpreter->name);
            break;
        case LOOP_IDLE:
            for (;;) {
                pause();
            }
        case LOOP_CHURN:
            for (;;) {
                run_ticks(L, interpreter->name, CHURN_TICKS);
                lua_close(L);
                printf("[%s] closed %p\n", interpreter->name, (void *) L);
                fflush(stdout);
                L = open_interpreter(interpreter);
            }
    }
    return NULL;
}

static lua_State *open_interpreter(Interpreter *interpreter)
{
    lua_State *L = luaL_newstate();

    luaL_openlibs(L);
    lua_pushstring(L, interpreter->name);
    lua_setglobal(L, "host_name");
    lua_pushcfunction(L, report);
    lua_setglobal(L, "report");
    lua_pushcfunction(L, sleep_ms);
    lua_setglobal(L, "sleep_ms");
    if (luaL_dostring(L, script) != LUA_OK) {
        fail(L, "script");
    }
    printf("[%s] lua_State %p, loop in %s\n", interpreter->name, (void *) L, loop_names[interpreter->loop]);
    fflush(stdout);
    return L;
}

static int report(lua_State *L)
{
    const char *name;

    lua_getglobal(L, "host_name");
    name = lua_tostring(L, -1);
    printf("[%s] %s\n", name, luaL_checkstring(L, 1));
    fflush(stdout);
    lua_pop(L, 1);
    return 0;
}

static int sleep_ms(lua_State *L)
{
    lua_Integer duration = luaL_checkinteger(L, 1);

    if (lua_gettop(L) != 1) {
        printf("CORRUPT stack in sleep_ms: %d\n", lua_gettop(L));
        fflush(stdout);
    }
    usleep((useconds_t) duration * 1000);
    return 0;
}

static void run_c_loop(lua_State *L, const char *name)
{
    for (;;) {
        run_ticks(L, name, 1);
    }
}

static void run_busy_loop(lua_State *L, const char *name)
{
    time_t second = time(NULL);
    long ticks = 0;

    for (;;) {
        lua_getglobal(L, "tick");
        if (lua_pcall(L, 0, 0, 0) != LUA_OK) {
            fail(L, "tick");
        }
        ticks++;
        if (time(NULL) != second) {
            printf("[%s] %ld ticks/s\n", name, ticks);
            fflush(stdout);
            second = time(NULL);
            ticks = 0;
        }
    }
}

static void run_ticks(lua_State *L, const char *name, int count)
{
    int i;

    for (i = 0; i != count; i++) {
        lua_getglobal(L, "tick");
        if (lua_pcall(L, 0, 0, 0) != LUA_OK) {
            fail(L, "tick");
        }
        if (lua_gettop(L) != 0) {
            printf("CORRUPT stack in %s: %d\n", name, lua_gettop(L));
            fflush(stdout);
        }
        usleep(20000);
    }
}

static void fail(lua_State *L, const char *what)
{
    printf("%s failed: %s\n", what, lua_tostring(L, -1));
    fflush(stdout);
    exit(1);
}
