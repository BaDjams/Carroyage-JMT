// jobSteps.js — Étapes d'une tâche du gestionnaire de tâches (mode Créer MBTiles).
//
// Toutes les étapes sont annoncées dès le départ, chacune avec sa barre de
// progression. Une étape finie affiche une coche verte et le temps qu'elle a
// pris ; l'étape en cours, son avancement et le temps restant estimé.
// Utilisé par mbtilesCreator.js (téléchargement) et fileToMbtiles.js (fichier).

function jobFormatDuration(ms) {
    if (ms < 1000) return '< 1 s';
    const s = Math.round(ms / 1000);
    if (s < 60) return `${s} s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m} min ${String(s % 60).padStart(2, '0')} s`;
    return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
}

class JobSteps {
    // steps : [{ id, label, total, auto }] dans l'ordre d'exécution. auto = false :
    // l'étape ne se termine que par finish(), même son compte atteint.
    constructor(steps) {
        this.el = document.createElement('div');
        this.el.className = 'job-steps';
        this.list = document.createElement('ol');
        this.footer = document.createElement('div');
        this.footer.className = 'job-steps-total';
        this.el.append(this.list, this.footer);
        this.steps = new Map();
        this.t0 = 0; this.t1 = 0; this.pausedAt = 0;
        this._timer = null; this._pending = null;
        for (const s of steps) this.add(s);
        this.render();
    }

    add({ id, label, total = 0, auto = true }) {
        const row = document.createElement('li');
        row.innerHTML = '<span class="job-step-icon" aria-hidden="true"></span><span class="job-step-label"></span>'
            + '<span class="job-step-info"></span><span class="job-step-bar"><span></span></span>';
        row.querySelector('.job-step-label').textContent = label;
        this.list.append(row);
        this.steps.set(id, { label, total, auto, done: 0, state: 'pending', t0: 0, ms: 0, note: '', row });
    }

    setTotal(id, total) { const s = this.steps.get(id); if (s) { s.total = total; this.schedule(); } }
    setNote(id, note) { const s = this.steps.get(id); if (s) { s.note = note; this.schedule(); } }

    start(id) {
        const s = this.steps.get(id);
        if (!s || s.state !== 'pending') return;
        const now = Date.now();
        s.state = 'running'; s.t0 = now;
        if (!this.t0) this.t0 = now;
        if (!this._timer) this._timer = setInterval(() => this.render(), 1000);
        this.schedule();
    }

    advance(id, n = 1) {
        const s = this.steps.get(id);
        if (!s) return;
        this.start(id);
        s.done += n;
        if (s.auto && s.total && s.done >= s.total) this.finish(id);
        else this.schedule();
    }

    finish(id, note) {
        const s = this.steps.get(id);
        if (!s || s.state === 'done') return;
        this.start(id);
        s.state = 'done'; s.ms = Date.now() - s.t0; s.done = Math.max(s.done, s.total);
        if (note != null) s.note = note;
        this.t1 = Date.now();
        this.stopTimerIfIdle();
        this.render();
    }

    // Échec : l'étape en cours passe en erreur, les suivantes ne seront pas faites.
    fail(message) {
        for (const s of this.steps.values()) {
            if (s.state === 'running') { s.state = 'error'; s.ms = Date.now() - s.t0; if (message) s.note = message; }
            else if (s.state === 'pending') s.state = 'skipped';
        }
        this.t1 = Date.now();
        this.stopTimerIfIdle(true);
        this.render();
    }

    cancel() {
        for (const s of this.steps.values()) {
            if (s.state === 'running') { s.state = 'cancelled'; s.ms = Date.now() - s.t0; }
            else if (s.state === 'pending') s.state = 'skipped';
        }
        this.t1 = Date.now();
        this.stopTimerIfIdle(true);
        this.render();
    }

    // Les pauses ne comptent ni dans les durées ni dans le temps restant.
    pause() { if (!this.pausedAt) { this.pausedAt = Date.now(); this.render(); } }
    resume() {
        if (!this.pausedAt) return;
        const d = Date.now() - this.pausedAt;
        this.pausedAt = 0;
        if (this.t0) this.t0 += d;
        for (const s of this.steps.values()) if (s.state === 'running') s.t0 += d;
        this.render();
    }

    get finished() { return [...this.steps.values()].every(s => s.state === 'done'); }

    stopTimerIfIdle(force = false) {
        if (force || ![...this.steps.values()].some(s => s.state === 'running')) { clearInterval(this._timer); this._timer = null; }
    }

    // Rendu groupé : l'avancement est signalé à chaque tuile.
    schedule() { if (!this._pending) this._pending = setTimeout(() => { this._pending = null; this.render(); }, 150); }

    render() {
        const now = this.pausedAt || Date.now(), num = n => n.toLocaleString('fr-FR');
        for (const s of this.steps.values()) {
            s.row.className = `job-step is-${s.state}`;
            const pct = s.state === 'done' ? 100 : s.total ? Math.min(100, 100 * s.done / s.total) : 0;
            s.row.querySelector('.job-step-bar > span').style.width = `${pct}%`;
            let info = '';
            if (s.state === 'done') info = jobFormatDuration(s.ms) + (s.note ? ` · ${s.note}` : '');
            else if (s.state === 'running') {
                const elapsed = now - s.t0;
                const parts = [];
                if (s.total) parts.push(`${num(s.done)} / ${num(s.total)}`);
                if (this.pausedAt) parts.push('en pause');
                else if (s.total && s.done > 0 && elapsed > 3000) parts.push(`reste ~${jobFormatDuration((s.total - s.done) * elapsed / s.done)}`);
                else if (!s.total) parts.push(jobFormatDuration(elapsed));
                if (s.note) parts.push(s.note);
                info = parts.join(' · ');
            } else if (s.state === 'error') info = s.note || 'erreur';
            else if (s.state === 'cancelled') info = 'annulé';
            else if (s.total) info = `${num(s.total)} tuiles`;
            s.row.querySelector('.job-step-info').textContent = info;
            s.row.title = s.state === 'error' && s.note ? s.note : '';
        }
        const states = [...this.steps.values()].map(s => s.state);
        this.footer.textContent = !this.t0 ? ''
            : states.every(st => st === 'done') ? `Durée totale : ${jobFormatDuration(this.t1 - this.t0)}`
            : states.some(st => st === 'running' || st === 'pending') ? `Écoulé : ${jobFormatDuration(now - this.t0)}`
            : `Arrêté après ${jobFormatDuration(this.t1 - this.t0)}`;
    }
}
