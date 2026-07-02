import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const [, , rawName, rawTitle, rawSessionLabel, rawCourseName] = process.argv

if (!rawName) {
  console.error('Usage: npm run new:deck -- <file-name> ["Slide Title"] ["Session 02"] ["Java Programming"]')
  process.exit(1)
}

const root = process.cwd()
const srcDir = path.join(root, 'src')
const templatePath = path.join(srcDir, 'templates', 'session-template.md')
const fileName = rawName.endsWith('.md') ? rawName : `${rawName}.md`
const outputPath = path.join(srcDir, fileName)

if (!outputPath.startsWith(srcDir)) {
  console.error('Deck path must stay inside the src directory.')
  process.exit(1)
}

if (fs.existsSync(outputPath)) {
  console.error(`Deck already exists: ${path.relative(root, outputPath)}`)
  process.exit(1)
}

const startCase = (value) => value
  .replace(/\.md$/i, '')
  .replace(/[-_]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .replace(/\b\w/g, (char) => char.toUpperCase())

const inferredTitle = startCase(path.basename(fileName, '.md'))
const title = rawTitle || inferredTitle
const sessionLabel = rawSessionLabel || 'Session XX'
const courseName = rawCourseName || 'Java Programming'

const template = fs.readFileSync(templatePath, 'utf8')
const content = template
  .replaceAll('{{TITLE}}', title)
  .replaceAll('{{SESSION_LABEL}}', sessionLabel)
  .replaceAll('{{COURSE_NAME}}', courseName)

fs.writeFileSync(outputPath, content, 'utf8')

console.log(`Created ${path.relative(root, outputPath)}`)
console.log(`Develop with: npm run dev -- ${path.relative(root, outputPath)}`)
