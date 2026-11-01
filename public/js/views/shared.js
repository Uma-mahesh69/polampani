// View fragments shared across pages.
import { esc, relTime, sqlDate } from '../core.js';
import { t, workName, workIcon, notifText, NOTIF_ICON } from '../i18n.js';
import { icon } from '../ui.js';

const FEATURE_LABELS = () => ({
  proximity: t('Distance to field'), skill: t('Skill match'), availability: t('Free on those days'), wage: t('Wage fairness'),
  reliability: t('Rating and show-up'), experience: t('Experience'), rapport: t('Worked together before'),
});

export function modelCard(m, { compact = false } = {}) {
  const labels = FEATURE_LABELS();
  const feats = [...m.features].sort((a, b) => b.importance - a.importance);
  const acc = m.recent_accuracy ?? m.accuracy;
  return `<div class="panel-head"><h2>${icon('sparkle')}${t('How matching works')}</h2></div>
    ${compact ? '' : `<p class="small muted" style="margin-bottom:12px">${t('Each worker gets a score for every job from these signals. The model learns from every accept, decline and no-show, so the weights shift to match how people here actually decide.')}</p>`}
    ${feats.map((f) => {
    const diff = f.importance - f.prior_importance;
    const trend = diff > 0.005 ? `${icon('trend', 'up')}` : diff < -0.005 ? `<span class="down" title="${t('Less important than at the start')}">${icon('down')}</span>` : '';
    return `<div class="feat"><span>${esc(labels[f.key] || f.key)}</span><div class="feat-bar"><div style="width:${Math.round(f.importance * 100 / 0.3)}%"></div></div><span class="feat-val">${Math.round(f.importance * 100)}%${trend}</span></div>`;
  }).join('')}
    <p class="small" style="margin-top:12px">${t('Learned from {n} responses', { n: m.samples })}${acc != null ? `. ${t('Predicts {p}% of responses correctly.', { p: Math.round(acc * 100) })}` : ''}</p>`;
}

export function outlookList(items, { worker = false } = {}) {
  if (!items?.length) return `<p class="muted small">${t('No strong demand signals in the next three weeks.')}</p>`;
  const levels = { tight: t('Tight'), busy: t('Busy'), balanced: t('Balanced') };
  return `<ul class="outlook">${items.map((o) => `<li>
      <span class="crop" aria-hidden="true">${workIcon(o.work_type)}</span>
      <div class="grow"><b class="small">${esc(workName(o.work_type))}</b>
        <div class="small muted">${worker
    ? (o.has_skill ? t('In demand. You have this skill.') : t('In demand. Add it to your skills if you can do it.'))
    : o.posted_workers ? t('{need} workers wanted, {have} skilled nearby', { need: o.posted_workers, have: o.skilled_workers }) : t('Season is starting. {have} skilled workers nearby.', { have: o.skilled_workers })}</div></div>
      <span class="level level-${o.level}">${levels[o.level]}</span>
    </li>`).join('')}</ul>`;
}

export function notifHref(n, role) {
  if (!n.job_id) return '#/';
  return role === 'farmer' ? `#/f/jobs/${n.job_id}` : `#/w/jobs/${n.job_id}`;
}

export function notifList(list, role) {
  if (!list.length) return '';
  const today = new Date().toDateString();
  let group = null;
  return list.map((n) => {
    const d = sqlDate(n.created_at).toDateString();
    const g = d === today ? t('Today') : t('Earlier');
    const head = g !== group ? `<div class="notif-group">${g}</div>` : '';
    group = g;
    return `${head}<a class="notif ${n.read ? '' : 'unread'}" href="${notifHref(n, role)}" data-act="notifOpen" data-id="${n.id}">
      <span class="ic-wrap">${icon(NOTIF_ICON[n.type] || 'bell')}</span>
      <div class="grow"><p>${esc(notifText(n))}</p><time>${esc(relTime(n.created_at))}</time></div>
    </a>`;
  }).join('');
}
