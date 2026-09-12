const { query } = require('./src/config/db');

const categories = [
  { name: 'Electronics', description: 'Electronic devices and gadgets' },
  { name: 'Shoes', description: 'Footwear and shoes' },
  { name: 'Jewelry', description: 'Jewelry and accessories' },
  { name: 'Kids', description: 'Kids clothing and products' },
  { name: 'Clothes', description: 'Clothing and apparel' },
  { name: 'Hats', description: 'Hats and headwear' },
  { name: 'Bags', description: 'Bags and backpacks' },
  { name: 'Accessories', description: 'Fashion accessories' },
];

async function seedCategories() {
  try {
    console.log('Seeding categories...');
    
    for (const category of categories) {
      const slug = category.name.toLowerCase().replace(/\s+/g, '-');
      
      const result = await query(
        `INSERT INTO categories (name, slug, description, is_active) 
         VALUES ($1, $2, $3, true) 
         ON CONFLICT(name) DO NOTHING 
         RETURNING *`,
        [category.name, slug, category.description]
      );
      
      if (result.rowCount > 0) {
        console.log(`✓ Created category: ${category.name}`);
      } else {
        console.log(`- Category already exists: ${category.name}`);
      }
    }
    
    console.log('✓ Seeding complete!');
    process.exit(0);
  } catch (error) {
    console.error('Failed to seed categories:', error);
    process.exit(1);
  }
}

seedCategories();
