export function moneyCents(value){
 const text=String(value).trim().replace(',','.');if(!/^\d{1,7}(?:\.\d{1,2})?$/.test(text))throw Error('Montant invalide : utilisez au maximum deux décimales.');
 const [whole,fraction='']=text.split('.');return Number(whole)*100+Number(fraction.padEnd(2,'0'));
}
export function compareOffers(input){
 const price=moneyCents(input.price),cost=moneyCents(input.cost),budget=moneyCents(input.budget),fee=moneyCents(input.fee||'0');
 const stock=Number(input.stock),quantity=Number(input.quantity),discount=Number(input.discount),rate=Number(input.rate||0);
 if(price<=0||!Number.isSafeInteger(stock)||stock<0||stock>1000000||!Number.isSafeInteger(quantity)||quantity<2||quantity>1000||!Number.isFinite(discount)||discount<0||discount>100||!Number.isFinite(rate)||rate<0||rate>100)throw Error('Vérifiez le prix, le stock, la taille du lot et les pourcentages.');
 return [{id:'regular',label:'Prix normal',units:1,price},{id:'discount',label:'Réduction',units:1,price:Math.round(price*(1-discount/100))},{id:'bundle',label:'Lot',units:quantity,price:moneyCents(input.bundlePrice)}].map(offer=>{
  const fees=Math.round(offer.price*rate/100)+fee,contribution=offer.price-cost*offer.units-fees,maxSales=Math.floor(stock/offer.units);
  const required=contribution>0?Math.ceil(budget/contribution):null;
  return {...offer,cost:cost*offer.units,fees,contribution,maxSales,remaining:stock%offer.units,required,requiredUnits:required===null?null:required*offer.units,canCover:required!==null&&required<=maxSales,fullStockResult:contribution*maxSales-budget,budget};
 });
}

