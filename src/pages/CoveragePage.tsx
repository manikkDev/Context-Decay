import Card from '../components/ui/Card.tsx'

function CoveragePage() {
  return (
    <div className="space-y-6">
      <div className="rounded-3xl p-6 surface-glass">
        <div className="text-xs font-semibold text-[color:rgb(var(--color-muted))]">What This Prototype Can Analyze</div>
        <div className="mt-2 text-balance text-2xl font-semibold tracking-tight">
          Supported knowledge areas and known ecosystem changes
        </div>
        <div className="mt-2 max-w-3xl text-sm text-[color:rgb(var(--color-muted))]">
          You can paste any link or text. This prototype only flags relevance issues when the content depends on known
          ecosystem changes. It uses a curated list of ~25–30 high-impact changes and never guesses or invents decay.
        </div>
        <div className="mt-3 max-w-3xl text-sm text-[color:rgb(var(--color-muted))]">
          In simple terms: it extracts what the content expects to be true about tools or platforms, then checks whether
          those expectations conflict with known changes.
        </div>
      </div>

      <Card heading="Supported knowledge areas" description="These are the specific ecosystem changes this prototype knows about.">
        <div className="grid gap-5 lg:grid-cols-2">
          <div className="rounded-2xl border border-[color:rgb(var(--color-border))] bg-[rgb(var(--color-bg))] p-4">
            <div className="text-sm font-semibold">Frontend Frameworks</div>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-[color:rgb(var(--color-muted))]">
              <li>Create React App deprecation</li>
              <li>React StrictMode double rendering behavior</li>
              <li>React Router v5 to v6 breaking changes</li>
              <li>AngularJS end-of-life</li>
              <li>Vue 2 end-of-life</li>
              <li>jQuery discouraged for modern applications</li>
            </ul>
            <div className="mt-3 text-sm text-[color:rgb(var(--color-muted))]">
              Frontend tutorials often break when recommended tools or defaults change.
            </div>
          </div>

          <div className="rounded-2xl border border-[color:rgb(var(--color-border))] bg-[rgb(var(--color-bg))] p-4">
            <div className="text-sm font-semibold">Package Management &amp; Runtime</div>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-[color:rgb(var(--color-muted))]">
              <li>Node.js 12 end-of-life</li>
              <li>Node.js 14 end-of-life</li>
              <li>npm now bundled with Node (older install assumptions)</li>
              <li>npx behavior changes</li>
              <li>Yarn v1 vs Yarn Berry workflow differences</li>
            </ul>
          </div>

          <div className="rounded-2xl border border-[color:rgb(var(--color-border))] bg-[rgb(var(--color-bg))] p-4">
            <div className="text-sm font-semibold">Backend Frameworks</div>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-[color:rgb(var(--color-muted))]">
              <li>Spring Boot 3 breaking changes</li>
              <li>Django dropping Python 2 support</li>
              <li>Rails Webpacker deprecation</li>
              <li>Flask async limitations compared to modern expectations</li>
            </ul>
          </div>

          <div className="rounded-2xl border border-[color:rgb(var(--color-border))] bg-[rgb(var(--color-bg))] p-4">
            <div className="text-sm font-semibold">Cloud Hosting &amp; Deployment</div>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-[color:rgb(var(--color-muted))]">
              <li>Heroku free tier removal</li>
              <li>Netlify build limit policy changes</li>
              <li>Firebase Spark plan limitations</li>
              <li>AWS free tier misconceptions</li>
              <li>Docker Compose v1 deprecation</li>
            </ul>
          </div>

          <div className="rounded-2xl border border-[color:rgb(var(--color-border))] bg-[rgb(var(--color-bg))] p-4">
            <div className="text-sm font-semibold">DevOps &amp; Tooling</div>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-[color:rgb(var(--color-muted))]">
              <li>GitHub default branch rename (master → main)</li>
              <li>Travis CI free tier removal</li>
              <li>CircleCI credit-based pricing changes</li>
              <li>Kubernetes API deprecations</li>
            </ul>
          </div>

          <div className="rounded-2xl border border-[color:rgb(var(--color-border))] bg-[rgb(var(--color-bg))] p-4">
            <div className="text-sm font-semibold">Security &amp; Policy Defaults</div>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-[color:rgb(var(--color-muted))]">
              <li>OAuth implicit flow discouraged</li>
              <li>TLS 1.0 deprecation</li>
              <li>TLS 1.1 deprecation</li>
              <li>SHA-1 deprecation</li>
              <li>Password-only authentication discouraged</li>
            </ul>
          </div>
        </div>
      </Card>

      <Card heading="What users should search for">
        <div className="max-w-3xl text-sm text-[color:rgb(var(--color-muted))]">
          This prototype works best for:
        </div>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-[color:rgb(var(--color-muted))]">
          <li>Tutorials</li>
          <li>Setup guides</li>
          <li>Blog posts</li>
          <li>Q&amp;A answers</li>
          <li>Deployment walkthroughs</li>
          <li>Tool or framework recommendations</li>
        </ul>
      </Card>

      <Card heading="What may not show results">
        <div className="max-w-3xl text-sm text-[color:rgb(var(--color-muted))]">
          The following may not produce decay analysis:
        </div>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-[color:rgb(var(--color-muted))]">
          <li>Programming fundamentals (loops, arrays, algorithms)</li>
          <li>Math or theory content</li>
          <li>Actively maintained official documentation</li>
          <li>Content that does not depend on changing tools</li>
        </ul>
        <div className="mt-4 max-w-3xl text-sm text-[color:rgb(var(--color-muted))]">
          This does not mean the content is bad — decay analysis simply does not apply.
        </div>
      </Card>

      <Card heading="Final reassurance">
        <div className="max-w-3xl text-sm text-[color:rgb(var(--color-muted))]">
          The list is intentionally limited. Coverage focuses on high-impact, widely recognized changes. Silence is
          preferred over guesswork. The goal is trust and clarity, not completeness.
        </div>
      </Card>
    </div>
  )
}

export default CoveragePage

