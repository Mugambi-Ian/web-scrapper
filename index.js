const { generateCSV } = require('./eysltd.biz');
const fs = require('fs')

const books = JSON.parse(fs.readFileSync('./data/eysltd.biz/books.json', { encoding: 'utf-8' }))
const value = generateCSV(books)
fs.writeFileSync('./data/eysltd.biz/products.csv',value,{encoding:'utf-8'})
