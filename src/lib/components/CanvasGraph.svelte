<script lang="ts">
  import type { DetectedRing } from '../engine/rings';

  interface Props {
    ring: DetectedRing;
    width?: number;
    height?: number;
  }
  const { ring, width = 660, height = 250 }: Props = $props();

  const HUB_COLOR: Record<string, string> = { device: '#22d3ee', ip: '#fbbf24', card: '#a78bfa', phone: '#f472b6' };
  const HUB_LABEL: Record<string, string> = { device: '设备', ip: 'IP', card: '卡', phone: '手机号' };

  const MAX_HUBS = 8;
  const MAX_SPOKES = 26;

  /**
   * Each shared device/IP is a hub placed on an inner ring; spokes radiate outward
   * to one dot per linked member. Spoke count is capped for legibility, and the
   * true count is shown in the label so the visual never overstates the evidence.
   */
  const model = $derived.by(() => {
    const hubs = ring.links
      .filter((l) => l.members >= 2)
      .slice(0, MAX_HUBS);
    const cx = width / 2;
    const cy = height / 2;
    const innerR = Math.min(52, height * 0.22);
    const outerR = Math.min(width, height) * 0.46;
    const hubNodes = hubs.map((h, i) => {
      const angle = (i / Math.max(1, hubs.length)) * Math.PI * 2 - Math.PI / 2;
      return {
        ...h,
        x: cx + Math.cos(angle) * innerR,
        y: cy + Math.sin(angle) * innerR * 1.5,
        color: HUB_COLOR[h.type] ?? '#5b8cff',
      };
    });
    const spokes: Array<{ x1: number; y1: number; x2: number; y2: number; color: string; hub: number }> = [];
    const dots: Array<{ x: number; y: number; color: string }> = [];
    for (const hub of hubNodes) {
      const shown = Math.min(hub.members, MAX_SPOKES);
      const baseAngle = Math.atan2(hub.y - cy, hub.x - cx);
      const spread = Math.min(Math.PI * 1.25, (shown / Math.max(4, MAX_SPOKES)) * Math.PI * 1.6);
      for (let k = 0; k < shown; k++) {
        const t = shown === 1 ? 0 : k / (shown - 1) - 0.5;
        const angle = baseAngle + t * spread;
        const x2 = cx + Math.cos(angle) * outerR;
        const y2 = cy + Math.sin(angle) * outerR * 0.92;
        spokes.push({ x1: hub.x, y1: hub.y, x2, y2, color: hub.color, hub: hubNodes.indexOf(hub) });
        dots.push({ x: x2, y: y2, color: hub.color });
      }
    }
    return { hubNodes, spokes, dots };
  });
</script>

<div class="graph-wrap">
  <svg {width} {height} viewBox="0 0 {width} {height}" role="img" aria-label="团伙关联证据图">
    <g opacity="0.4">
      {#each model.spokes as s}
        <line x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke={s.color} stroke-width="0.8" />
      {/each}
    </g>
    <g>
      {#each model.dots as d}
        <circle cx={d.x} cy={d.y} r="2.4" fill={d.color} opacity="0.75" />
      {/each}
    </g>
    <g>
      {#each model.hubNodes as h}
        <circle cx={h.x} cy={h.y} r="10" fill={h.color} opacity="0.22" />
        <circle cx={h.x} cy={h.y} r="5" fill={h.color} />
        <text x={h.x} y={h.y + 20} text-anchor="middle" class="hub-label" fill={h.color}>
          {HUB_LABEL[h.type]} · {h.members > MAX_SPOKES ? `${h.members}+` : h.members}
        </text>
      {/each}
    </g>
  </svg>
  <div class="caption">
    <div class="legend">
      {#each Object.entries(HUB_COLOR) as [kind, color]}
        <span class="lg"><span class="dot" style="background:{color}"></span>{HUB_LABEL[kind]}</span>
      {/each}
    </div>
    <span class="spacer"></span>
    <span class="tiny faint">每个中心点 = 一个被共享的设备/IP，向外辐射的线条数量代表关联成员数（超过 {MAX_SPOKES} 时标注 +）</span>
  </div>
</div>

<style>
  .graph-wrap {
    background: radial-gradient(420px 160px at 50% 50%, rgba(91,140,255,0.07), transparent 72%), var(--bg);
    border-radius: 10px;
    border: 1px solid var(--border);
    padding: 6px 8px 8px;
    overflow: hidden;
  }
  svg { display: block; width: 100%; height: auto; }
  .hub-label { font-family: var(--mono); font-size: 9.5px; font-weight: 600; }
  .caption { display: flex; align-items: center; gap: 12px; padding: 2px 4px; flex-wrap: wrap; }
  .legend { display: flex; align-items: center; gap: 12px; }
  .lg { display: flex; align-items: center; gap: 5px; font-size: 10.5px; color: var(--text-dim); }
  .dot { width: 7px; height: 7px; border-radius: 50%; display: inline-block; }
</style>
