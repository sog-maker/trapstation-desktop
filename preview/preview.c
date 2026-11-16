/* SPDX-License-Identifier: GPL-3.0-only
 * Trap Station desktop: the editor's audition engine. It is the TRAPSTATION OS firmware itself (track 1 of the
 * host build, with the FM6 engine), compiled to WebAssembly by preview/build.sh. Nothing here talks to a device.
 * FM6 core: msfa (Dexed), Apache-2.0, integer port by Leo Kuroshita; see LICENSES in the firmware repository. */
#include "felucca_web.c"

static float pv_left[128], pv_right[128];

EXPORT float *pv_out_l(void) { return pv_left; }
EXPORT float *pv_out_r(void) { return pv_right; }
EXPORT uint32_t pv_param_count(void) { return P_COUNT; }
EXPORT uint32_t pv_fm6_count(void) { return TF6_COUNT; }
EXPORT uint32_t pv_is_fm6(void) { return trk[0].eng_req == ENGI_FM6; }
EXPORT uint32_t pv_engine(void) { return trk[0].eng_req; }

/* names as the device shows them */
EXPORT const char *pv_name(uint32_t bank, uint32_t slot)
{
    if (bank == 0 && slot < 8) return BANK_A[slot].name;
    if (bank > 0 && bank < 5 && slot < 8) return BANK_EXTRA[bank - 1][slot].name;
    return "";
}
EXPORT const char *pv_machine(void) { return trk_machine(&trk[0])->pill; }
EXPORT const char *pv_fm6_name(uint32_t slot) { return slot < TF6_COUNT ? TF6_NAMES[slot] : ""; }

EXPORT void pv_panic(void)
{
    seq_stop();
    panic_req = (1u << NPART) - 1;
    for (uint32_t i = 0; i < 8; ++i) web_render(128);
}

/* a factory preset on track 1: bank 0..4 (A..E), slot 0..7; the other tracks stay silent */
EXPORT int pv_load(uint32_t bank, uint32_t slot)
{
    if (bank > 4 || slot > 7) return 0;
    pv_panic();
    for (uint32_t i = 0; i < G_COUNT; ++i) song.g[i] = GP[i].def;
    if (!bank) trap_bank_a_load(&trk[0], slot);
    else trap_bank_load(&trk[0], bank - 1, slot);
    trk[0].p[P_MUTE] = 0;
    for (uint32_t t = 1; t < NPART; ++t) trk[t].p[P_MUTE] = 1;
    for (uint32_t i = 0; i < 16; ++i) web_render(128);
    return 1;
}

EXPORT void pv_init(void)
{
    web_nor_erase(); web_master(800); web_bootmenu(0); web_boot();
    for (uint32_t i = 0; i < 1100; ++i) web_render(128);
    fxl_mute = 1;
    pv_load(0, 0);
}

/* the 111 track parameters (drums, 808, mono, sampler, and the sends of an FM6 track) */
EXPORT int pv_param_get(uint32_t id) { return id < P_COUNT ? trk[0].p[id] : 0; }
EXPORT int pv_param_min(uint32_t id) { return id < P_COUNT ? track_desc(&trk[0], id)->min : 0; }
EXPORT int pv_param_max(uint32_t id) { return id < P_COUNT ? track_desc(&trk[0], id)->max : 0; }
EXPORT const char *pv_param_name(uint32_t id) { return id < P_COUNT ? track_desc(&trk[0], id)->label : ""; }
EXPORT int pv_param_enum(uint32_t id) { return id < P_COUNT && track_desc(&trk[0], id)->names != 0; }
EXPORT const char *pv_param_text(uint32_t id, int value)
{
    static char text[80]; const char *unit = 0;
    if (id >= P_COUNT) return "";
    param_format(track_desc(&trk[0], id), value, text, &unit);
    return text;
}
EXPORT int pv_param_set(uint32_t id, int value)
{
    if (id >= P_COUNT || id == P_E7) return 0;
    trk[0].p[id] = param_fit(track_desc(&trk[0], id), value);
    return 1;
}

/* the shared delay and reverb settings the FM6 pages show (TIME FDBK TONE / TIME DAMP GRIT) */
static const uint8_t PV_G[6] = {G_DTIME, G_DFDBK, G_DCOLOR, G_RSIZE, G_RDAMP, G_RTYPE};
EXPORT int pv_global_get(uint32_t k) { return k < 6 ? song.g[PV_G[k]] : 0; }
EXPORT int pv_global_max(uint32_t k) { return k < 6 ? GP[PV_G[k]].max : 0; }
EXPORT int pv_global_set(uint32_t k, int value)
{
    if (k >= 6) return 0;
    song.g[PV_G[k]] = param_fit(&GP[PV_G[k]], value);
    return 1;
}

/* the FM6 voice of track 1: 155 voice bytes, then DRIVE (0..100), CUTOFF (40..20000 Hz), OUTPUT (0..100).
 * The engine picks an edit up in its next block, held notes included (tf6_sync). */
EXPORT int pv_fm6_get(uint32_t id) { return id < 158 ? tf6_edit[0][id] : 0; }
EXPORT int pv_fm6_max(uint32_t id) { return id < 155 ? (int)fm6_max(id) : id == 156 ? 20000 : id < 158 ? 100 : 0; }
EXPORT int pv_fm6_set(uint32_t id, int value)
{
    int lo = id == 156 ? 40 : 0;
    if (id >= 158 || id >= 145 && id < 155 || value < lo || value > pv_fm6_max(id)) return 0;
    if (!tf6_ready[0]) tf6_load(0, 0);
    tf6_edit[0][id] = (int16_t)value;
    return 1;
}
/* a factory FM6 voice by its number in the bank (0..TF6_COUNT-1) */
EXPORT int pv_fm6_load(uint32_t slot)
{
    if (slot >= TF6_COUNT) return 0;
    tf6_load(0, slot);
    return 1;
}

EXPORT void pv_note(uint32_t note, uint32_t velocity, uint32_t on)
{
    if (note > 127 || velocity > 127) return;
    if (on && velocity) trk_note_on(&trk[0], note, velocity);
    else trk_note_off(&trk[0], note);
}

EXPORT void pv_render(void)
{
    web_render(128);
    memcpy(pv_left, out_l, sizeof pv_left);
    memcpy(pv_right, out_r, sizeof pv_right);
}
