#include <pthread.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>

typedef uint64_t (* StoreForm) (uint8_t * slot);

#define FORM(name, body) \
    __attribute__((naked, noinline)) uint64_t name (uint8_t * slot) { __asm__ volatile (body); }

FORM (form_str_w, "movz w1, #0x5555\n str w1, [x0]\n ret")
FORM (form_str_x, "movz x1, #0x5555\n movk x1, #0x6666, lsl #32\n str x1, [x0]\n ret")
FORM (form_strb, "mov w1, #0x77\n strb w1, [x0, #1]\n ret")
FORM (form_strh, "mov w1, #0x7788\n strh w1, [x0, #2]\n ret")
FORM (form_stur, "movz w1, #0x5151\n add x0, x0, #8\n stur w1, [x0, #-8]\n ret")
FORM (form_str_s, "fmov s0, #2.5\n str s0, [x0]\n ret")
FORM (form_str_d, "fmov d0, #-1.5\n str d0, [x0, #-4]\n ret")
FORM (form_str_q, "movi v0.16b, #0x3c\n str q0, [x0, #-8]\n ret")
FORM (form_pre, "sub x0, x0, #4\n movz w1, #0x4242\n str w1, [x0, #4]!\n ret")
FORM (form_post, "movz w1, #0x4343\n str w1, [x0], #12\n ret")
FORM (form_stp_w, "movz w1, #0x1111\n movz w2, #0x2222\n stp w1, w2, [x0, #-4]\n ret")
FORM (form_stp_x_pre, "movz x1, #0x3333\n movz x2, #0x4444\n add x0, x0, #20\n stp x1, x2, [x0, #-24]!\n ret")
FORM (form_reg, "mov x2, #1\n sub x0, x0, #4\n movz w1, #0x6161\n str w1, [x0, x2, lsl #2]\n ret")
FORM (form_stlr, "movz w1, #0x7171\n stlr w1, [x0]\n ret")
FORM (form_swp, "movz w1, #0x8181\n swp w1, w2, [x0]\n mov x0, x2\n ret")

static const StoreForm forms[] = {
  form_str_w, form_str_x, form_strb, form_strh, form_stur, form_str_s, form_str_d, form_str_q,
  form_pre, form_post, form_stp_w, form_stp_x_pre, form_reg, form_stlr, form_swp,
};

__attribute__((aligned (64))) uint8_t slab[64];
volatile int command = -1;
volatile int done = -1;
volatile uint64_t result;

static void *
runner (void * unused)
{
  for (;;)
  {
    int form = command;
    if (form >= 0 && form != done)
    {
      result = forms[form] (slab + 16);
      done = form;
    }
    usleep (1000);
  }
  return NULL;
}

int
main (void)
{
  pthread_t thread;
  printf ("pid %d slab %p forms %zu\n", getpid (), (void *) slab, sizeof (forms) / sizeof (forms[0]));
  fflush (stdout);
  pthread_create (&thread, NULL, runner, NULL);
  for (;;)
    pause ();
}
