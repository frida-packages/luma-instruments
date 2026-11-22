#include <pthread.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#define HIT_DAMAGE 13
#define POISON_TICKS 5000

struct hero {
    char name[16];
    float health;
    int32_t gold;
};

int32_t health = 100;
int32_t stats[8] = { 4242, 4242, 4242, 4242, 4242, 4242, 4242, 4242 };
char game_status[512];

struct hero *hero;
volatile double *shield;
static pthread_mutex_t lock = PTHREAD_MUTEX_INITIALIZER;
static int hits;
static int poison_runs;

static void take_hit(void);
void *poison(void *argument);
static void report(const char *event);
void game_status_changed(void);

int main(void)
{
    volatile double shield_on_stack = 100.5;
    sigset_t commands;
    pthread_t poisoner;

    shield = &shield_on_stack;
    hero = calloc(1, sizeof(struct hero));
    strcpy(hero->name, "hero");
    hero->health = 100.25f;
    hero->gold = 1234567;

    printf("pid=%d health=%p hero.health=%p shield=%p\n", getpid(), (void *) &health, (void *) &hero->health,
        (void *) shield);

    sigemptyset(&commands);
    sigaddset(&commands, SIGUSR1);
    sigaddset(&commands, SIGUSR2);
    sigaddset(&commands, SIGTERM);
    pthread_sigmask(SIG_BLOCK, &commands, NULL);

    pthread_mutex_lock(&lock);
    report("ready");
    pthread_mutex_unlock(&lock);

    for (;;) {
        int command;
        sigwait(&commands, &command);
        if (command == SIGTERM)
            break;
        if (command == SIGUSR1) {
            pthread_mutex_lock(&lock);
            take_hit();
            report("hit");
            pthread_mutex_unlock(&lock);
        } else {
            pthread_create(&poisoner, NULL, poison, NULL);
            pthread_detach(poisoner);
        }
    }
    return 0;
}

__attribute__((noinline)) static void take_hit(void)
{
    health -= HIT_DAMAGE;
    hero->health -= HIT_DAMAGE;
    *shield -= HIT_DAMAGE;
    hits++;
}

__attribute__((noinline)) void *poison(void *argument)
{
    for (int tick = 0; tick != POISON_TICKS; tick++) {
        pthread_mutex_lock(&lock);
        health -= 1;
        hero->health -= 1;
        *shield -= 1;
        pthread_mutex_unlock(&lock);
    }
    pthread_mutex_lock(&lock);
    poison_runs++;
    report("poisoned");
    pthread_mutex_unlock(&lock);
    return NULL;
}

static void report(const char *event)
{
    snprintf(game_status, sizeof(game_status), "%s hits=%d poison=%d int=%d float=%.2f double=%.2f gold=%d",
        event, hits, poison_runs, health, hero->health, *shield, hero->gold);
    puts(game_status);
    fflush(stdout);
    game_status_changed();
}

__attribute__((noinline)) void game_status_changed(void)
{
    __asm__ volatile ("" ::: "memory");
}
