<Slide2 topic="Arrays">
  <template #content>

<div class="slide-h1" style="margin-bottom:12px;">What is an <span class="highlight">Array ?</span></div>

<div class="g2" style="gap:14px;align-items:start;">

<div class="flex-col">
  <div v-click class="card-navy" style="border-radius:10px;">
    <div style="font-size:.82rem;line-height:1.6;color:var(--slate);">
      An <strong style="color:var(--red);">array</strong> is a single variable that holds <strong style="color:var(--green);">many values of the same type</strong>, stored side by side in memory and accessed by an <strong>index</strong>.
    </div>
  </div>

  <div v-click class="card card-red">
    <div class="slide-h3" style="color:var(--red-dark);">Without an Array — Painful!</div>
    <div class="code-block" style="margin-top:6px;font-size:.7rem;">
      <span style="color:#0e6ead;">int</span> mark1 = <span style="color:#b45309;">90</span>;<br>
      <span style="color:#0e6ead;">int</span> mark2 = <span style="color:#b45309;">85</span>;<br>
      <span style="color:#0e6ead;">int</span> mark3 = <span style="color:#b45309;">78</span>;<br>
      <span style="color:#0e6ead;">int</span> mark4 = <span style="color:#b45309;">92</span>;<br>
      <span style="color:#0e6ead;">int</span> mark5 = <span style="color:#b45309;">88</span>;
    </div>
  </div>

  <div v-click class="card card-green">
    <div class="slide-h3" style="color:var(--green);">With an Array — Clean!</div>
    <div class="code-block" style="margin-top:6px;font-size:.7rem;">
      <span style="color:#0e6ead;">int</span>[] <span style="color:#0e6ead;">marks</span> = {<span style="color:#b45309;">90</span>, <span style="color:#b45309;">85</span>, <span style="color:#b45309;">78</span>, <span style="color:#b45309;">92</span>, <span style="color:#b45309;">88</span>};
    </div>
  </div>
</div>

<div class="flex-col">
  <div v-click class="section-label">Memory View — Side by Side</div>

  <div v-after class="arr-strip-with-idx">
    <div class="arr-strip">
      <div class="arr-cell">90</div>
      <div class="arr-cell">85</div>
      <div class="arr-cell">78</div>
      <div class="arr-cell">92</div>
      <div class="arr-cell">88</div>
    </div>
    <div class="idx-row">
      <div>[0]</div><div>[1]</div><div>[2]</div><div>[3]</div><div>[4]</div>
    </div>
  </div>

  <div v-click class="callout callout-info" style="font-size:.7rem;">
    <div><strong>One name, many slots.</strong> <span class="mono">marks[0]</span> is 90, <span class="mono">marks[4]</span> is 88. Loop through them in 2 lines.</div>
  </div>

  <div v-click class="card card-blue">
    <div class="small-text"><strong>Quick wins:</strong></div>
    <div style="display:flex;gap:6px;margin-top:4px;flex-wrap:wrap;">
      <span class="pill pill-red">No copy-paste</span>
      <span class="pill pill-blue">Loop friendly</span>
      <span class="pill pill-green">Less memory</span>
    </div>
  </div>
</div>

</div>

  </template>
</Slide2>
