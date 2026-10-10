let quantity = 1;
const q = document.getElementById("qty");
const toast = document.getElementById("toast");
function notify(message){toast.textContent=message;toast.classList.add("show");setTimeout(()=>toast.classList.remove("show"),4200)}
document.getElementById("year").textContent = new Date().getFullYear();
document.getElementById("minus").addEventListener("click",()=>{quantity=Math.max(1,quantity-1);q.textContent=quantity});
document.getElementById("plus").addEventListener("click",()=>{quantity=Math.min(5,quantity+1);q.textContent=quantity});
// Real checkout (iyzico) when the server enables it; otherwise the unpaid demo flow.
let checkout = false;
fetch("/api/config").then(r=>r.json()).then(c=>{
  document.getElementById("price").textContent=new Intl.NumberFormat("en-US",{style:"currency",currency:c.currency||"USD"}).format(c.price);
  if (c.checkoutEnabled) {
    checkout = true;
    document.getElementById("orderBtn").innerHTML = "Buy now <span>↗</span>";
    document.getElementById("orderNote").textContent = c.checkoutSandbox
      ? "TEST MODE: payments go to the iyzico sandbox. Use an iyzico test card; no real money is charged."
      : "Secure card payment on iyzico's hosted page. We never see your card details.";
  }
}).catch(()=>{});
document.getElementById("orderBtn").addEventListener("click",()=>{
  document.querySelector("body > .admin-card")?.remove();
  const variant = document.getElementById("variant").value;
  const wrap = document.createElement("div");
  wrap.innerHTML = `<div class="admin-card" role="dialog" aria-modal="true" aria-label="Test order" style="position:fixed;z-index:20;left:50%;top:50%;transform:translate(-50%,-50%);width:min(92vw,480px);max-height:90vh;overflow:auto;box-shadow:0 20px 80px #392c2566"><button type="button" id="closeDemo" class="admin-btn" style="float:right">Close</button>${checkout?'<p class="eyebrow">SECURE CHECKOUT · IYZICO</p><h2 style="font-size:30px">Shipping details</h2><p class="micro">Next, you will pay by card on iyzico\'s secure page.</p>':'<p class="eyebrow">DEMO ONLY · NO PAYMENT</p><h2 style="font-size:30px">Test order details</h2><p class="micro">This is a development preview. No payment will be collected and this order must not be shipped.</p>'}<form id="demoForm" class="admin-form"><label>Full name</label><input name="name" required maxlength="120"><label>Email</label><input type="email" name="email" required maxlength="254"><label>Phone (optional)</label><input name="phone" maxlength="40"><label>Address</label><input name="address1" required maxlength="200"><label>Apartment, suite (optional)</label><input name="address2" maxlength="200"><label>City</label><input name="city" required maxlength="100"><label>State</label><input name="state" required maxlength="100"><label>ZIP code</label><input name="postalCode" required maxlength="20"><label>Country</label><input name="country" value="United States" required><input type="hidden" name="quantity" value="${quantity}"><input type="hidden" name="variant"><button class="button full" type="submit">${checkout?"Continue to payment":"Create test order (unpaid)"}</button></form></div>`;
  document.body.appendChild(wrap.firstElementChild);
  document.querySelector('#demoForm input[name="variant"]').value = variant;
  document.getElementById("closeDemo").onclick=()=>document.querySelector("body > .admin-card")?.remove();
  document.getElementById("demoForm").addEventListener("submit",async e=>{
    e.preventDefault(); const data=Object.fromEntries(new FormData(e.target).entries());
    const btn=e.target.querySelector("button[type=submit]");btn.disabled=true;
    if(checkout){try{const r=await fetch("/api/checkout",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(data)});const j=await r.json();if(!r.ok||!j.paymentPageUrl)throw new Error(j.error||"Could not start payment.");location.href=j.paymentPageUrl}catch(err){btn.disabled=false;notify(err.message)}return}
    try{const r=await fetch("/api/demo-order",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(data)});const j=await r.json();if(!r.ok)throw new Error(j.error||"Could not create demo order.");document.querySelector("body > .admin-card")?.remove();notify(`Test order ${j.orderNumber} created. UNPAID — do not ship.`)}catch(err){btn.disabled=false;notify(err.message)}
  });
});
