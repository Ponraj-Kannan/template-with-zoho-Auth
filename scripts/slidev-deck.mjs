import { spawn } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'
import fs from 'node:fs'

const [, , action = 'dev', deckArg, ...extraArgs] = process.argv
const root = process.cwd()
const defaultDeck = 'src/01-introduction-to-java.md'
const deck = deckArg || process.env.SLIDEV_DECK || defaultDeck
const resolvedDeck = path.isAbsolute(deck) ? deck : path.join(root, deck)
// Use node + slidev.mjs directly — avoids shell:true and the Windows cmd.exe
// issue where parentheses in the CWD path are treated as subshell grouping.
// process.execPath is always the current node binary (no shell needed).
const slidevMjs = path.join(root, 'node_modules', '@slidev', 'cli', 'bin', 'slidev.mjs')
const slidevBin = process.execPath  // node binary

// Template system integration
const templatesDir = path.join(root, 'templates')
const hasTemplateSystem = fs.existsSync(templatesDir)

// Validate that the deck file exists
if (!fs.existsSync(resolvedDeck)) {
  console.error(`Error: Slide deck not found: ${resolvedDeck}`)
  console.error(`Available sessions:`)
  
  try {
    const srcDir = path.join(root, 'src')
    const files = fs.readdirSync(srcDir)
    const sessionFiles = files.filter(f => f.match(/^\d{2}-.+\.md$/))
    
    if (sessionFiles.length > 0) {
      sessionFiles.forEach(file => {
        const sessionNum = file.match(/^(\d{2})-/)[1]
        console.error(`   ${file} (use: npm run dev:${sessionNum})`)
      })
    } else {
      console.error('   No session files found.')
      if (hasTemplateSystem) {
        console.error('   Create one with: npm run new:session')
        console.error('   Or use the template workflow: npm run workflow:new')
      } else {
        console.error('   Create one manually or set up the template system first.')
      }
    }
  } catch (error) {
    console.error('   Could not list available sessions')
  }
  
  process.exit(1)
}

// Enhanced arguments for better development experience
const baseArgs = action === 'build'
  ? ['build', resolvedDeck, '--base', '/', ...extraArgs]
  : [resolvedDeck, ...extraArgs]

// Add development-specific enhancements
if (action === 'dev') {
  // Add --open flag if not already present and not explicitly disabled
  if (!extraArgs.includes('--no-open') && !extraArgs.includes('--open')) {
    baseArgs.push('--open')
  }
  
  // Add --host flag for network access if requested
  if (extraArgs.includes('--host') && !extraArgs.some(arg => arg.startsWith('--host='))) {
    const hostIndex = baseArgs.indexOf('--host')
    if (hostIndex !== -1) {
      baseArgs[hostIndex] = '--host=0.0.0.0'
    }
  }
  
  // Add --port flag if specified
  const portArg = extraArgs.find(arg => arg.startsWith('--port='))
  if (portArg) {
    const portIndex = baseArgs.indexOf(portArg)
    if (portIndex === -1) {
      baseArgs.push(portArg)
    }
  }
}

console.log(`${action === 'build' ? 'Building' : 'Starting development server for'}: ${path.relative(root, resolvedDeck)}`)

// On Windows, .cmd files require a shell to execute — but cmd.exe treats
// parentheses "(" ")" as subshell grouping operators, which breaks any path
// that contains them (e.g. "D:\course-template(Google+Zoho)\...").
//
// Fix: use `shell: true` but wrap every argument in double-quotes so that
// cmd.exe sees them as literal strings rather than syntax characters.
//
// On non-Windows (Linux/macOS), just pass args normally without a shell.
// Spawn node directly with slidev.mjs — no shell involved, works on all
// platforms including Windows paths with parentheses/special characters.
const child = spawn(slidevBin, [slidevMjs, ...baseArgs], {
  stdio: 'inherit',
  shell: false,
  env: {
    ...process.env,
    // Ensure Vite config is used
    VITE_CONFIG_PATH: path.join(root, 'vite.config.ts'),
    // Set memory limit for build
    ...(action === 'build' ? { NODE_OPTIONS: '--max_old_space_size=3072' } : {}),
    // Set slide deck path for potential use in config
    SLIDEV_DECK: resolvedDeck,
  },
})

child.on('exit', (code) => {
  if (code !== 0) {
    console.error(`\nSlide ${action} failed with exit code ${code}`)
    
    if (action === 'dev') {
      console.error('Try the following troubleshooting steps:')
      console.error('1. Check that the slide file syntax is valid')
      console.error('2. Ensure all components are properly imported')
      console.error('3. Validate frontmatter configuration')
      if (hasTemplateSystem) {
        console.error('4. Run: npm run template:validate ' + path.relative(root, resolvedDeck))
        console.error('5. Check template system: npm run workflow:help')
      } else {
        console.error('4. Consider setting up the template system for better validation')
      }
    }
  }
  
  process.exit(code ?? 0)
})
