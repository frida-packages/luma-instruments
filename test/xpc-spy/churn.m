#import <Foundation/Foundation.h>
#import <xpc/xpc.h>
#include <pthread.h>

#define CONNECTIONS_IN_FLIGHT 32

static xpc_endpoint_t endpoint;
static volatile long rounds;
static NSMutableArray *held_requests;
static NSMutableArray *standing_clients;

static void *churn(void *context)
{
    dispatch_queue_t reply_queue = dispatch_queue_create("replies", NULL);
    long thread = (long)context;
    dispatch_semaphore_t in_flight = dispatch_semaphore_create(CONNECTIONS_IN_FLIGHT);
    for (;;) {
        dispatch_semaphore_wait(in_flight, DISPATCH_TIME_FOREVER);
        @autoreleasepool {
            xpc_connection_t client = xpc_connection_create_from_endpoint(endpoint);
            xpc_connection_set_event_handler(client, ^(xpc_object_t event) {
                if (event == XPC_ERROR_CONNECTION_INVALID)
                    dispatch_semaphore_signal(in_flight);
            });
            xpc_connection_resume(client);
            xpc_object_t request = xpc_dictionary_create(NULL, NULL, 0);
            xpc_dictionary_set_int64(request, "thread", thread);
            xpc_connection_send_message_with_reply(client, request, reply_queue, ^(xpc_object_t reply) {
                (void)thread;
            });
            xpc_connection_cancel(client);
            __sync_fetch_and_add(&rounds, 1);
        }
    }
    return NULL;
}

static void hold_request(xpc_object_t request)
{
    @synchronized (held_requests) {
        [held_requests addObject:request];
    }
}

static void connect_standing_client(dispatch_queue_t reply_queue)
{
    xpc_connection_t client = xpc_connection_create_from_endpoint(endpoint);
    xpc_connection_set_event_handler(client, ^(xpc_object_t event) {});
    xpc_connection_resume(client);
    xpc_object_t request = xpc_dictionary_create(NULL, NULL, 0);
    xpc_dictionary_set_bool(request, "hold", true);
    xpc_connection_send_message_with_reply(client, request, reply_queue, ^(xpc_object_t reply) {});
    [standing_clients addObject:client];
}

int main(int argc, char *argv[])
{
    @autoreleasepool {
        int threads = (argc > 1) ? atoi(argv[1]) : 4;
        int standing = (argc > 2) ? atoi(argv[2]) : 0;
        printf("pid %d\n", getpid());
        held_requests = [NSMutableArray array];
        standing_clients = [NSMutableArray array];

        xpc_connection_t listener = xpc_connection_create(NULL, NULL);
        xpc_connection_set_event_handler(listener, ^(xpc_object_t peer) {
            if (xpc_get_type(peer) != XPC_TYPE_CONNECTION)
                return;
            xpc_connection_set_event_handler(peer, ^(xpc_object_t event) {
                if (xpc_get_type(event) != XPC_TYPE_DICTIONARY)
                    return;
                if (xpc_dictionary_get_bool(event, "hold"))
                    hold_request(event);
                else
                    xpc_connection_send_message(peer, xpc_dictionary_create_reply(event));
            });
            xpc_connection_resume(peer);
        });
        xpc_connection_resume(listener);
        endpoint = xpc_endpoint_create(listener);

        dispatch_queue_t reply_queue = dispatch_queue_create("standing replies", NULL);
        for (int i = 0; i != standing; i++)
            connect_standing_client(reply_queue);

        for (long thread = 0; thread != threads; thread++) {
            pthread_t handle;
            pthread_create(&handle, NULL, churn, (void *)thread);
        }
        for (;;) {
            sleep(2);
            printf("rounds %ld\n", rounds);
            fflush(stdout);
        }
    }
}
