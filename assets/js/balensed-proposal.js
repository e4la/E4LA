const paymentStatus = new URLSearchParams(window.location.search).get('payment');
const successMessage = document.getElementById('payment-success');

if (paymentStatus === 'success' && successMessage) {
  successMessage.textContent = 'Thank you. Your payment was submitted securely through Stripe. E4LA will contact you with the onboarding steps.';
}
