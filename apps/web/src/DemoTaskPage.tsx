const plans = [
  { name: "Solo", price: "$19", description: "For individual researchers", features: ["1 active study", "50 sessions"] },
  { name: "Team", price: "$59", description: "For a small research team", features: ["5 active studies", "500 sessions", "Shared projects"], featured: true },
  { name: "Studio", price: "$149", description: "For established research groups", features: ["Unlimited studies", "2,000 sessions", "Priority support"] },
];

export function DemoTaskPage() {
  const checkout = window.location.pathname === "/demo/checkout";
  return (
    <main className="demo-target-page">
      <nav className="demo-target-nav" aria-label="Demo product navigation">
        <a href="/demo/pricing" className="demo-target-brand">Northstar Research</a>
        <div><a href="#features">Features</a><a href="/demo/pricing">Pricing</a><a href="#support">Support</a></div>
      </nav>
      {checkout ? (
        <section className="demo-checkout-card">
          <p className="eyebrow">Checkout</p>
          <h1>Team plan selected</h1>
          <p>You found the plan designed for a small research team. The study task is complete.</p>
          <a className="primary-button" href="/demo/pricing">Back to pricing</a>
        </section>
      ) : (
        <>
          <header className="demo-target-hero">
            <p className="eyebrow">Simple, transparent plans</p>
            <h1>Research tools that grow with your team</h1>
            <p>Compare plans and choose the workspace that matches your research practice.</p>
          </header>
          <section className="demo-pricing-grid" aria-label="Pricing plans">
            {plans.map((plan) => (
              <article key={plan.name} className={plan.featured ? "demo-plan featured" : "demo-plan"}>
                {plan.featured && <span className="demo-plan-badge">Best for small teams</span>}
                <h2>{plan.name}</h2>
                <p>{plan.description}</p>
                <strong>{plan.price}<small>/month</small></strong>
                <ul>{plan.features.map((feature) => <li key={feature}>✓ {feature}</li>)}</ul>
                <a className={plan.featured ? "primary-button" : "secondary-button"} href="/demo/checkout">Choose {plan.name}</a>
              </article>
            ))}
          </section>
        </>
      )}
    </main>
  );
}
