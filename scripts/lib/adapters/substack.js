import RssParser from 'rss-parser'

const parser = new RssParser()

export async function checkNewPosts(publicationUrl) {
  const rssUrl = publicationUrl.replace(/\/$/, '') + '/feed'
  const feed = await parser.parseURL(rssUrl)
  return (feed.items || []).map(item => ({
    title: item.title,
    url: item.link,
    date: item.isoDate || item.pubDate,
    content: item['content:encoded'] || item.content || '',
  }))
}

export async function login(page, email, password) {
  await page.goto('https://substack.com/sign-in')
  await page.waitForSelector('input[type="email"]', { timeout: 10000 })
  await page.fill('input[type="email"]', email)
  await page.click('button:has-text("Continue")')
  await page.waitForSelector('input[type="password"]', { timeout: 10000 })
  await page.fill('input[type="password"]', password)
  await page.click('button:has-text("Log in")')
  await page.waitForTimeout(3000)
}

export async function fetchArticle(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2000)

  const content = await page.evaluate(() => {
    const article = document.querySelector('.available-content, .body.markup, article')
    return article ? article.innerText : document.body.innerText
  })

  const title = await page.evaluate(() => {
    const h1 = document.querySelector('h1')
    return h1 ? h1.innerText : document.title
  })

  return { title, content, url }
}
