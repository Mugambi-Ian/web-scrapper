const puppeteer = require('puppeteer');

const fs = require('fs')

const timeout = 300000

function scrapeCategory() {
  String.prototype.cleanText = function () {
    return this.trim().replace(/\s+/g, ' ');
  };

  const categories = []
  const cards = Array.from(document.querySelectorAll('div.pg-body > div.container > div.row > div.col-md-3'));
  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    const categoryHref = card.querySelector('h4 > a').href
    const categoryTitle = card.querySelector('h4 > a').textContent.cleanText();

    const listings = []
    const listingCards = Array.from(card.querySelectorAll('a'));
    for (let j = 0; j < listingCards.length; j++) {

      const listing = listingCards[j];
      const listingHref = listing.href;
      const listingTitle = listing.textContent.cleanText()
      if (j !== 0)
        listings.push({ listingTitle, listingHref, books: [] })
      console.log({ listingTitle, listingHref });
    }
    categories.push({ categoryHref, categoryTitle, listings })
  }
  return categories;
}


function scrapeBooks(_books = []) {
  String.prototype.cleanText = function () {
    return this.trim().replace(/\s+/g, ' ');
  };
  let count = 0;
  const total = document.getElementById('ContentPlaceHolder1_lblCount')
  if (total)
    count = parseInt(total.textContent.cleanText().split(' Of ')[1])

  const books = _books;
  const cards = document.querySelectorAll('div.col-lg-3.col-md-6.col-sm-4.col-xs-4.plr-5')
  if (cards)
    for (let i = 0; i < cards.length; i++) {
      const book = cards[i];
      const bookImage = book.getElementsByTagName('img')[0].src;
      const bookTitle = book.querySelector('p.pl-name').textContent.cleanText()
      const bookAuthor = book.querySelector('p.pl-author').textContent.cleanText()
      const bookPrice = book.querySelector('p.pl-price-block > span > span').textContent.cleanText()
      const inStock = book.querySelector('div.outofstockp').style.display === 'none'
      books.push({ inStock, bookImage, bookTitle, bookPrice, bookAuthor })
    }

  const page = Math.ceil(books.length / 12)
  const more = books.length !== count
  const pages = Math.ceil(count / 12)
  return {
    more, page, books, pages
  }
}

async function scrapeData() {
  const browser = await puppeteer.launch({ headless: false, timeout });
  const newPage = async () => {
    const page = await browser.newPage();
    page.setRequestInterception(true);

    page.on('request', (request) => {
      if (request.resourceType() == "image" || request.resourceType() == "stylesheet" || request.resourceType() === "script" || request.resourceType() === "font") {
        const u = request.url();
        // console.log(`request to ${u.substring(0, 50)}...${u.substring(u.length - 5)} is aborted`);
        request.abort();
        return;
      }
      request.continue();
    });
    return page;
  }

  const page = await newPage()
  await page.goto('https://eysltd.biz/AllCategories', { waitUntil: "networkidle0", timeout });

  const categories = await page.evaluate(scrapeCategory);

  let data = JSON.stringify(categories)
  fs.writeFileSync('categories.json', data, 'utf-8')
  writelog('Scrapping ' + categories.length + ' categories')


  const result = []
  let promises = []

  let books = 0
  for (let i = 0; i < categories.length; i++) {
    let listings = [];
    const categoryIndex = '' + (i + 1) + '/' + categories.length + '';
    const category = { categoryHref: categories[i].categoryHref, categoryTitle: categories[i].categoryTitle };
    writelog(categoryIndex + '  Scrapping ' + categories[i].listings.length + ' listings in category ' + category.categoryTitle)
    for (let j = 0; j < categories[i].listings.length; j++) {
      const promise = async () => {
        const listing = categories[i].listings[j];
        const listingPage = await newPage()
        await listingPage.goto(listing.listingHref, { waitUntil: 'networkidle0', timeout })
        const products = await listingPage.evaluate(scrapeBooks, listing.books)
        await listingPage.close()

        const listingIndex = categoryIndex + ' : ' + Math.ceil(((j + 1) / categories[i].listings.length) * 100) + '% || ';
        let productPromises = []

        const checkMore = async (page) => {
          const morePage = await newPage();
          await morePage.goto(listing.listingHref + "/stock=0&page=" + (page), { waitUntil: 'networkidle0', timeout })
          const prs = await morePage.evaluate(scrapeBooks, []);
          await morePage.close()
          return prs.books;
        }

        for (let i = 1; i < products.pages; i++) {
          productPromises.push(checkMore(i));
          if (productPromises.length === 10) {
            const books = (await Promise.all(productPromises)).reduce((p, n) => p.concat(n));
            products.books = [...products.books, ...books]
            productPromises = []
          }
        }

        if (productPromises.length !== 0) {
          const books = (await Promise.all(productPromises)).reduce((p, n) => p.concat(n));
          products.books = [...products.books, ...books]
          productPromises = []
        }

        writelog(listingIndex + '  Scrapped ' + products.books.length + ' books of ' + listing.listingTitle + ' in ' + category.categoryTitle)
        books += products.books.length
        return {
          listingTitle: listing.listingTitle,
          listingHref: listing.listingHref,
          books: products.books
        }
      }

      promises.push(promise())
      if (promises.length === 40) {
        const updates = await Promise.all(promises);
        listings = [...listings, ...updates]
        promises = []
      }

    }
    if (promises.length !== 0) {
      const updates = await Promise.all(promises);
      listings = [...listings, ...updates]
      promises = []
    }


    writelog(categoryIndex + ' current total ' + books)
    result.push({ ...category, listings })
    data = JSON.stringify(result)


    fs.writeFileSync('books.json', data, 'utf-8')
  }

}

scrapeData();

let log = ''
function writelog(s) {
  log += "\n" + s

  fs.writeFileSync('app.log', log, 'utf-8')
}
