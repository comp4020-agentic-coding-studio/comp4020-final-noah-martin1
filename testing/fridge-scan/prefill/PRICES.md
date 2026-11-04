# Prefilled prices on real detections

Every distinct price suggestion for the items Qwen3-VL 8B and 2B listed on the 12 test photos (`results/*-tiles3.json`), on the seeded catalogue with no personal prices, as `name ×count → size price · source`. Read through by hand for wrong foods (none left after the guards in `src/scan-prefill.ts`). Items without a price aren't listed.

```
apple ×12 → 12  $8.62 · priced like Pink Lady Apples 1kg (ALDI) (~180 g each)
apple ×2 → 2  $1.44 · priced like Pink Lady Apples 1kg (ALDI) (~180 g each)
apple ×5 → 5  $3.59 · priced like Pink Lady Apples 1kg (ALDI) (~180 g each)
avocado ×1 → 1  $2.69 · priced like Hass Avocado Each (ALDI)
avocado ×2 → 2  $5.38 · priced like Hass Avocado Each (ALDI)
banana ×1 → 1  $0.47 · priced like the Woolworths price (~120 g each)
barbecue sauce ×1 → 500 ml $1.85 · Woolworths Barbecue Sauce Squeeze 500mL
black pepper ×1 → 100 g $5.60 · Hoyt's Pepper Black Whole 100g (Woolworths)
bread ×1 → 500 g $2.29 · LEVANT BAKERY Lebanese Bread Wholemeal 6 Pack 500g (ALDI)
bread ×3 → 1500 g $6.87 · 3 × LEVANT BAKERY Lebanese Bread Wholemeal 6 Pack 500g (ALDI)
butter ×1 → 500 g $6.99 · PURE VALLEY Salted Butter 500g (ALDI)
butter ×3 → 1500 g $20.97 · 3 × PURE VALLEY Salted Butter 500g (ALDI)
butter beans ×1 → 400 g $1.40 · La Gina Butter Beans 400g (Woolworths)
carrot ×6 → 6  $1.22 · priced like Woolworths Australian Grown Carrots 1kg (~120 g each)
carrot ×8 → 8  $1.63 · priced like Woolworths Australian Grown Carrots 1kg (~120 g each)
cheese ×1 → 1000 g $9.30 · Hillview Cheese Block 1kg (Woolworths)
cheese ×2 → 2000 g $18.60 · 2 × Hillview Cheese Block 1kg (Woolworths)
chicken ×1 → 650 g $9.40 · Woolworths RSPCA Approved Chicken Breast Fillets 650g
chicken ×2 → 1300 g $18.80 · 2 × Woolworths RSPCA Approved Chicken Breast Fillets 650g
chicken ×3 → 1950 g $28.20 · 3 × Woolworths RSPCA Approved Chicken Breast Fillets 650g
chicken ×4 → 650 g $9.40 · Woolworths RSPCA Approved Chicken Breast Fillets 650g
chicken ×6 → 650 g $9.40 · Woolworths RSPCA Approved Chicken Breast Fillets 650g
chicken stock ×1 → 1000 ml $1.90 · Woolworths Chicken Liquid Stock 1L
chickpeas ×1 → 400 g $1.40 · La Gina Chickpeas 400g (Woolworths)
chickpeas ×2 → 800 g $2.80 · 2 × La Gina Chickpeas 400g (Woolworths)
chickpeas ×5 → 400 g $1.40 · La Gina Chickpeas 400g (Woolworths)
chilli ×1 → 80 g $4.00 · roughly Woolworths Jalapeno Chilli Punnet 80g
chilli powder ×1 → 50 g $2.25 · Hoyt's Chilli Powder 50g (Woolworths)
chilli sauce ×1 → 700 ml $2.70 · roughly Woolworths Sweet Chilli Sauce 700mL
cinnamon ×1 → 41 g $2.39 · STONEMILL Cinnamon Ground 41g (ALDI)
coconut milk ×1 → 400 ml $1.90 · Pandaroo Coconut Milk 400mL (Woolworths)
cream cheese ×1 → 250 g $3.30 · Woolworths Cream Cheese Block 250g
cucumber ×2 → 2  $4.99 · priced like Lebanese Cucumbers 600g (ALDI) (~300 g each)
cucumber ×3 → 3  $7.49 · priced like Lebanese Cucumbers 600g (ALDI) (~300 g each)
cucumber ×4 → 4  $9.98 · priced like Lebanese Cucumbers 600g (ALDI) (~300 g each)
dill pickles ×4 → 1360 g $6.50 · Woolworths Whole Dill Pickles 1.36kg
dried peas ×1 → 500 g $1.90 · roughly McKenzie's Dried Green Split Peas 500g (Woolworths)
eggs ×3 → 3  $1.43 · priced like Woolworths 12 Pack Extra Large Cage Free Eggs 700g
english muffins ×2 → 12  $5.80 · 2 × Woolworths English Muffins 6 pack
fries ×2 → 2000 g $6.30 · 2 × Woolworths Essentials French Fries 1kg
garlic powder ×1 → 50 g $2.00 · Woolworths Garlic Powder 50g
green beans ×1 → 1000 g $2.79 · MARKET FARE Australian Green Beans 1kg (ALDI)
green olives ×1 → 350 g $4.95 · roughly Sandhurst Olives Green Pitted 350g (Woolworths)
honey ×1 → 400 g $4.20 · Cloverdale Pure Honey Squeeze 400g (Woolworths)
hot sauce ×2 → 900 ml $7.58 · 2 × ASIA GREEN GARDEN Sriracha Sauce Hot 450ml (ALDI)
hot sauce ×3 → 1350 ml $11.37 · 3 × ASIA GREEN GARDEN Sriracha Sauce Hot 450ml (ALDI)
ice cream ×1 → 4000 ml $6.99 · roughly MONARC Vanilla Reduced Fat Ice Cream 4L (ALDI)
jam ×1 → 500 g $3.00 · roughly The Real Jam Co. Plum 500g (Woolworths)
lemon ×1 → 1  $1.30 · priced like Lemon Bag 500g (Woolworths) (~100 g each)
lemon ×2 → 2  $2.60 · priced like Lemon Bag 500g (Woolworths) (~100 g each)
lettuce ×1 → 2  $3.00 · Woolworths Cos Hearts Lettuce 2 pack
lime ×1 → 1  $1.69 · priced like Lime Each (ALDI)
mayonnaise ×1 → 470 g $3.10 · Woolworths Traditional Mayonnaise 470g
milk ×1 → 2000 ml $3.39 · FARMDALE Light Milk 2L (ALDI)
milk ×2 → 4000 ml $6.78 · 2 × FARMDALE Light Milk 2L (ALDI)
milk ×3 → 6000 ml $10.17 · 3 × FARMDALE Light Milk 2L (ALDI)
mustard ×1 → 200 g $2.60 · Your Condiment Co Wholegrain Mustard 200g (Woolworths)
onion powder ×1 → 55 g $2.89 · STONEMILL Onion Powder 55g (ALDI)
orange ×1 → 1  $0.60 · priced like Navel Oranges 1.5kg (ALDI) (~180 g each)
orange ×6 → 6  $3.59 · priced like Navel Oranges 1.5kg (ALDI) (~180 g each)
orange ×7 → 7  $4.19 · priced like Navel Oranges 1.5kg (ALDI) (~180 g each)
orange juice ×1 → 2000 ml $5.50 · Woolworths Orange Juice 2L
orange juice ×2 → 4000 ml $11.00 · 2 × Woolworths Orange Juice 2L
oregano ×1 → 25 g $2.25 · Hoyt's Oregano 25g (Woolworths)
paprika ×1 → 100 g $3.20 · roughly Hoyt's Paprika Sweet 100g (Woolworths)
parsley ×1 → 15 g $2.25 · Hoyt's Parsley 15g (Woolworths)
pasta ×1 → 500 g $0.90 · roughly Woolworths Essentials Pasta Penne 500g
pear ×1 → 1  $0.72 · priced like Packham Pears 1kg (ALDI) (~180 g each)
pear ×2 → 2  $1.44 · priced like Packham Pears 1kg (ALDI) (~180 g each)
peas ×1 → 420 g $1.80 · Woolworths Garden Peas Green 420g
peas ×2 → 840 g $3.60 · 2 × Woolworths Garden Peas Green 420g
pineapple ×2 → 2  $11.98 · 2 × Pineapple Each (ALDI)
rice ×1 → 1000 g $2.50 · Woolworths Brown Rice Grain 1kg
rice vinegar ×1 → 300 ml $2.40 · roughly Lantern Alley Rice Wine Vinegar 300mL (Woolworths)
rosemary ×1 → 10 g $2.99 · Rosemary 10g (ALDI)
salsa ×1 → 300 g $1.90 · Woolworths Medium Salsa 300g
salt ×1 → 1000 g $2.75 · Saxa Iodised Cooking Salt 1kg (Woolworths)
sauerkraut ×1 → 500 g $4.50 · Sandhurst Sauerkraut 500g (Woolworths)
soy sauce ×1 → 500 ml $1.90 · Tiao Hu Soy Sauce 500mL (Woolworths)
sugar ×1 → 1000 g $2.65 · OH SO NATURAL ORGANIC Organic Raw Sugar 1kg (ALDI)
sugar ×2 → 2000 g $5.30 · 2 × OH SO NATURAL ORGANIC Organic Raw Sugar 1kg (ALDI)
sunflower seeds ×1 → 200 g $2.20 · Woolworths Sunflower Seeds 200g
thyme ×1 → 15 g $1.80 · Hoyt's Thyme 15g (Woolworths)
tomato ×1 → 1  $0.97 · priced like the Woolworths price
tomato ketchup ×1 → 220 ml $2.60 · roughly Heinz Tomato Ketchup Squeezy Bottle 220mL (Woolworths)
tomato ketchup ×2 → 440 ml $5.20 · roughly 2 × Heinz Tomato Ketchup Squeezy Bottle 220mL (Woolworths)
tuna ×1 → 185 g $1.69 · PORTVIEW Tuna Chunks in Springwater 185g (ALDI)
vegetable oil ×2 → 4000 ml $17.00 · 2 × Crisco Vegetable Blended Oil 2L (Woolworths)
yoghurt ×1 → 900 g $6.79 · roughly VAALIA French Vanilla Yoghurt 900g (ALDI)
yoghurt ×2 → 1800 g $13.58 · roughly 2 × VAALIA French Vanilla Yoghurt 900g (ALDI)
```
