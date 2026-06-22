import fs from 'fs';
import path from 'path';

async function processLogo() {
  console.log('--- Processing Logos and Icons ---');

  // Define the files we expect to find in the root folder
  const rootIcons = {
    'icon-512.png': [
      'public/icon-512.png',
      'public/logo.png',
      'public/landing/logo.png',
      'src/logo.png'
    ],
    'apple-touch-icon.png': [
      'public/apple-touch-icon.png'
    ],
    'favicon.png': [
      'public/favicon.png'
    ],
    'icon-72.png': [
      'public/icon-72.png'
    ],
    'icon-96.png': [
      'public/icon-96.png'
    ],
    'icon-144.png': [
      'public/icon-144.png'
    ],
    'icon-180.png': [
      'public/icon-180.png'
    ],
    'icon-192.png': [
      'public/icon-192.png'
    ]
  };

  // Check if we have at least some root icons uploaded
  let foundAnyRootIcon = false;
  for (const rootFile of Object.keys(rootIcons)) {
    if (fs.existsSync(rootFile)) {
      foundAnyRootIcon = true;
      break;
    }
  }

  if (foundAnyRootIcon) {
    console.log('Found newly uploaded icons in the root directory! Placing them...');

    // Copy each root icon to its target paths
    for (const [rootFile, targets] of Object.entries(rootIcons)) {
      if (fs.existsSync(rootFile)) {
        for (const target of targets) {
          try {
            const parentDir = path.dirname(target);
            if (!fs.existsSync(parentDir)) {
              fs.mkdirSync(parentDir, { recursive: true });
            }
            fs.copyFileSync(rootFile, target);
            console.log(`Copied root file ${rootFile} -> ${target} (${fs.statSync(rootFile).size} bytes)`);
          } catch (err) {
            console.error(`Failed to copy ${rootFile} to ${target}:`, err);
          }
        }
      } else {
        console.warn(`Root icon ${rootFile} is missing, skipping it.`);
      }
    }
  } else {
    console.log('No root icons found. Falling back to using available single source logo...');
    const possiblePaths = [
      'src/lib/apple-touch-icon.png',
      'src/logo.png',
      'logo.png',
      'public/logo.png'
    ];

    let sourcePath = null;
    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        sourcePath = p;
        break;
      }
    }

    if (!sourcePath) {
      console.error(`Source logo not found at: ${possiblePaths.join(', ')}`);
      process.exit(1);
    }

    console.log(`Using source logo path: ${sourcePath}`);

    const fallbackTargets = [
      'src/logo.png',
      'public/logo.png',
      'public/landing/logo.png',
      'public/favicon.png',
      'public/apple-touch-icon.png',
      'public/icon-72.png',
      'public/icon-96.png',
      'public/icon-144.png',
      'public/icon-180.png',
      'public/icon-192.png',
      'public/icon-512.png'
    ];

    for (const target of fallbackTargets) {
      if (sourcePath === target) {
        continue;
      }
      try {
        const parentDir = path.dirname(target);
        if (!fs.existsSync(parentDir)) {
          fs.mkdirSync(parentDir, { recursive: true });
        }
        fs.copyFileSync(sourcePath, target);
        console.log(`Fallback copied ${sourcePath} -> ${target}`);
      } catch (err) {
        console.error(`Failed fallback copy to ${target}:`, err);
      }
    }
  }

  console.log('All logo and icon processing completed perfectly!');
}

processLogo().catch(console.error);

