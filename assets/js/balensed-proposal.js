const paymentStatus = new URLSearchParams(window.location.search).get('payment');
const successMessage = document.getElementById('payment-success');
const paymentForm = document.getElementById('payment-form');
const autopay = document.getElementById('autopay');
const paymentChoice = document.getElementById('payment-choice');

if (paymentForm && autopay && paymentChoice) {
  const manualAction = paymentForm.action;
  const autopayAction = paymentForm.dataset.autopayAction;

  autopay.addEventListener('change', () => {
    paymentForm.action = autopay.checked ? autopayAction : manualAction;
    paymentChoice.textContent = autopay.checked
      ? 'Automatic payments selected: $1,500 today, then two charges of $1,200.'
      : 'Future payments will be made manually.';
  });
}

if (paymentStatus === 'success' && successMessage) {
  successMessage.textContent = 'Thank you. Your payment was submitted securely through Stripe. E4LA will contact you with the onboarding steps.';
}
