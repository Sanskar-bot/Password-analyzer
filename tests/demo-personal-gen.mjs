import { generateContextAwarePassword } from '../extension/modules/profilePasswordGenerator.js';

const profile = {
  firstName: 'Sanskar',
  lastName: 'Phougat',
  petName: 'Bruno',
  favoriteNumber: '7',
  customKeywords: ['cricket', 'chai'],
};
const websiteContext = {
  brand: 'Instagram',
  domain: 'instagram.com',
  keywords: ['Photo', 'Story', 'Social', 'Creative'],
};

console.log('Profile: firstName=Sanskar, lastName=Phougat, petName=Bruno, favoriteNumber=7');
console.log('Site:    Instagram');
console.log('Personal anchor letters: S (Sanskar), P (Phougat), B (Bruno)\n');

for (let i = 0; i < 8; i++) {
  const { password, validation, attempt } = await generateContextAwarePassword({
    profile, websiteContext,
    options: { wordCount: 3, symbols: true },
  });
  console.log(`${i+1}.  ${password.padEnd(38)}  strength=${validation.strengthScore} personalized=${validation.personalizedAttackScore} (attempt ${attempt})`);
}
