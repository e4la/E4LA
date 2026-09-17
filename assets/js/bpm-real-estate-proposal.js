const params = new URLSearchParams(window.location.search);
const paymentStatus = params.get('payment');
const plan = params.get('plan');
const success = document.getElementById('payment-success');

if (paymentStatus === 'success' && success) {
  const labels = {
    visibility: 'Visibility partnership',
    growth: 'Growth partnership',
    complete: 'Complete Growth + AI partnership',
    website2000: 'Strategic UX/UI + Conversion Redesign',
    website3000: 'Complete Growth Website Redesign'
  };
  const selected = labels[plan] || 'selected service';
  success.textContent = `Thank you. Your ${selected} payment was submitted securely through Stripe. E4LA will contact you with the onboarding and access steps.`;
  success.classList.add('show');
}
