export async function login(page, email, password) {
  await page.goto('https://accounts.ft.com/login')
  await page.waitForSelector('input[type="email"], #email', { timeout: 10000 })
  await page.fill('input[type="email"], #email', email)
  await page.click('button[type="submit"]')
  await page.waitForSelector('input[type="password"], #password', { timeout: 10000 })
  await page.fill('input[type="password"], #password', password)
  await page.click('button[type="submit"]')
  await page.waitForTimeout(3000)
}

export async function search(page, query, maxResults = 10) {
  const searchUrl = `https://www.ft.com/search?q=${encodeURIComponent(query)}&sort=date`
  await page.goto(searchUrl, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2000)

  const urls = await page.evaluate((max) => {
    const links = Array.from(document.querySelectorAll('a.js-teaser-heading-link, .o-teaser__heading a'))
    return links.slice(0, max).map(a => a.href).filter(h => h.includes('/content/'))
  }, maxResults)

  return urls
}

export async function fetchArticle(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2000)

  const title = await page.evaluate(() => {
    const h1 = document.querySelector('h1')
    return h1 ? h1.innerText : document.title
  })

  const content = await page.evaluate(() => {
    const article = document.querySelector('.article-body, .n-content-body, article')
    return article ? article.innerText : ''
  })

  const datePublished = await page.evaluate(() => {
    const time = document.querySelector('time[datetime]')
    return time ? time.getAttribute('datetime') : null
  })

  return { title, content, url, datePublished }
}
