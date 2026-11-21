#import <Foundation/Foundation.h>
#import <xpc/xpc.h>

@protocol Greeter
- (void)greet:(NSString *)name count:(NSInteger)count reply:(void (^)(NSString *greeting))reply;
@end

@interface GreeterService : NSObject <Greeter, NSXPCListenerDelegate>
@end

@implementation GreeterService

- (BOOL)listener:(NSXPCListener *)listener shouldAcceptNewConnection:(NSXPCConnection *)connection
{
    connection.exportedInterface = [NSXPCInterface interfaceWithProtocol:@protocol(Greeter)];
    connection.exportedObject = self;
    [connection resume];
    return YES;
}

- (void)greet:(NSString *)name count:(NSInteger)count reply:(void (^)(NSString *greeting))reply
{
    reply([NSString stringWithFormat:@"Hello %@ #%ld", name, (long)count]);
}

@end

static xpc_object_t make_rich_reply(xpc_object_t request)
{
    xpc_object_t reply = xpc_dictionary_create_reply(request);
    xpc_dictionary_set_string(reply, "status", "ok");
    xpc_dictionary_set_int64(reply, "seq", xpc_dictionary_get_int64(request, "seq"));
    xpc_dictionary_set_uint64(reply, "big", UINT64_MAX);
    xpc_dictionary_set_bool(reply, "flag", true);
    xpc_dictionary_set_double(reply, "ratio", 0.25);
    xpc_dictionary_set_date(reply, "when", 1700000000000000000LL);
    uint8_t bytes[] = { 0xde, 0xad, 0xbe, 0xef };
    xpc_dictionary_set_data(reply, "blob", bytes, sizeof(bytes));
    uuid_t uuid;
    uuid_generate(uuid);
    xpc_dictionary_set_uuid(reply, "id", uuid);
    xpc_dictionary_set_value(reply, "nothing", xpc_null_create());
    xpc_dictionary_set_fd(reply, "stdout", 1);
    xpc_object_t list = xpc_array_create(NULL, 0);
    xpc_array_append_value(list, xpc_string_create("a"));
    xpc_array_append_value(list, xpc_int64_create(-7));
    xpc_object_t nested = xpc_dictionary_create(NULL, NULL, 0);
    xpc_dictionary_set_string(nested, "inner", "value");
    xpc_array_append_value(list, nested);
    xpc_dictionary_set_value(reply, "list", list);
    return reply;
}

static void serve_peer(xpc_connection_t peer)
{
    xpc_connection_set_event_handler(peer, ^(xpc_object_t event) {
        if (xpc_get_type(event) != XPC_TYPE_DICTIONARY)
            return;
        if (xpc_dictionary_get_bool(event, "wants_reply")) {
            xpc_connection_send_message(peer, make_rich_reply(event));
        } else {
            xpc_object_t note = xpc_dictionary_create(NULL, NULL, 0);
            xpc_dictionary_set_string(note, "notice", "pushed by server");
            xpc_connection_send_message(peer, note);
        }
    });
    xpc_connection_resume(peer);
}

static xpc_connection_t make_client(xpc_endpoint_t endpoint, const char *label)
{
    xpc_connection_t client = xpc_connection_create_from_endpoint(endpoint);
    xpc_connection_set_event_handler(client, ^(xpc_object_t event) {
        char *description = xpc_copy_description(event);
        printf("[%s] event: %.120s\n", label, description);
        free(description);
    });
    xpc_connection_resume(client);
    return client;
}

static xpc_object_t make_request(int64_t seq, bool wants_reply)
{
    xpc_object_t request = xpc_dictionary_create(NULL, NULL, 0);
    xpc_dictionary_set_string(request, "op", wants_reply ? "query" : "poke");
    xpc_dictionary_set_int64(request, "seq", seq);
    xpc_dictionary_set_bool(request, "wants_reply", wants_reply);
    return request;
}

int main(int argc, char *argv[])
{
    @autoreleasepool {
        int burst = (argc > 1) ? atoi(argv[1]) : 0;
        printf("pid %d\n", getpid());

        dispatch_queue_t server_queue = dispatch_queue_create("server", NULL);
        xpc_connection_t listener = xpc_connection_create(NULL, server_queue);
        xpc_connection_set_event_handler(listener, ^(xpc_object_t peer) {
            if (xpc_get_type(peer) == XPC_TYPE_CONNECTION)
                serve_peer(peer);
        });
        xpc_connection_resume(listener);
        xpc_endpoint_t endpoint = xpc_endpoint_create(listener);

        xpc_connection_t early_client = make_client(endpoint, "early");

        GreeterService *service = [GreeterService new];
        NSXPCListener *nsListener = [NSXPCListener anonymousListener];
        nsListener.delegate = service;
        [nsListener resume];
        NSXPCConnection *nsClient = [[NSXPCConnection alloc] initWithListenerEndpoint:nsListener.endpoint];
        nsClient.remoteObjectInterface = [NSXPCInterface interfaceWithProtocol:@protocol(Greeter)];
        [nsClient resume];

        NSUserDefaults *defaults = [[NSUserDefaults alloc] initWithSuiteName:@"re.frida.xpc-spy-test"];

        dispatch_queue_t reply_queue = dispatch_queue_create("replies", NULL);
        for (int64_t tick = 0;; tick++) {
            xpc_connection_send_message(early_client, make_request(tick, false));

            xpc_connection_send_message_with_reply(early_client, make_request(tick, true), reply_queue, ^(xpc_object_t reply) {
                printf("[early] async reply type=%s\n", xpc_type_get_name(xpc_get_type(reply)));
            });

            xpc_object_t sync_reply = xpc_connection_send_message_with_reply_sync(early_client, make_request(tick, true));
            printf("[early] sync reply seq=%lld\n", xpc_dictionary_get_int64(sync_reply, "seq"));

            if (tick % 3 == 0) {
                xpc_connection_t late_client = make_client(endpoint, "late");
                xpc_object_t late_reply = xpc_connection_send_message_with_reply_sync(late_client, make_request(tick, true));
                printf("[late] sync reply status=%s\n", xpc_dictionary_get_string(late_reply, "status"));
                xpc_connection_cancel(late_client);

                xpc_connection_t missing = xpc_connection_create_mach_service("re.frida.xpc-spy-test.missing", NULL, 0);
                xpc_connection_set_event_handler(missing, ^(xpc_object_t event) {
                    printf("[missing] event: %s\n", event == XPC_ERROR_CONNECTION_INVALID ? "invalid" : "other");
                });
                xpc_connection_resume(missing);
                xpc_connection_send_message(missing, make_request(tick, false));

                xpc_connection_t fresh_listener = xpc_connection_create(NULL, server_queue);
                xpc_connection_set_event_handler(fresh_listener, ^(xpc_object_t peer) {
                    if (xpc_get_type(peer) == XPC_TYPE_CONNECTION)
                        serve_peer(peer);
                });
                xpc_connection_resume(fresh_listener);
                xpc_connection_t fresh_client = make_client(xpc_endpoint_create(fresh_listener), "fresh");
                xpc_object_t fresh_reply = xpc_connection_send_message_with_reply_sync(fresh_client, make_request(tick, true));
                printf("[fresh] sync reply status=%s\n", xpc_dictionary_get_string(fresh_reply, "status"));
                xpc_connection_cancel(fresh_client);
                xpc_connection_cancel(fresh_listener);

                NSXPCConnection *freshNSClient = [[NSXPCConnection alloc] initWithListenerEndpoint:nsListener.endpoint];
                freshNSClient.remoteObjectInterface = [NSXPCInterface interfaceWithProtocol:@protocol(Greeter)];
                [freshNSClient resume];
                [[freshNSClient synchronousRemoteObjectProxyWithErrorHandler:^(NSError *error) {
                    printf("[nsxpc fresh] error: %s\n", error.description.UTF8String);
                }] greet:@"fresh" count:tick reply:^(NSString *greeting) {
                    printf("[nsxpc fresh] %s\n", greeting.UTF8String);
                }];
                [freshNSClient invalidate];
            }

            uint64_t burst_start = clock_gettime_nsec_np(CLOCK_UPTIME_RAW);
            for (int i = 0; i != burst; i++)
                xpc_connection_send_message(early_client, make_request(i, false));
            if (burst != 0)
                printf("[burst] %d messages in %.2f ms\n", burst, (clock_gettime_nsec_np(CLOCK_UPTIME_RAW) - burst_start) / 1e6);

            [[nsClient remoteObjectProxy] greet:@"spy" count:tick reply:^(NSString *greeting) {
                printf("[nsxpc] %s\n", greeting.UTF8String);
            }];

            [defaults setInteger:tick forKey:@"tick"];
            printf("[defaults] tick=%ld\n", (long)[defaults integerForKey:@"tick"]);

            fflush(stdout);
            [NSThread sleepForTimeInterval:2.0];
        }
    }
}
