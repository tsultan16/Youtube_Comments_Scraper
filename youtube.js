const puppeteer = require('puppeteer');
const fs = require('fs');
const http = require('http');
const express = require('express');

const port = 3000; //process.env.PORT || 3030; 
const app = express();
const headlessBrowser = true;

async function main() {

    // middleware function for serving static html files
  app.use(express.static(__dirname + '/public'));

  // middleware function for extracting JSON post request body
  app.use(express.json());
  app.use(express.urlencoded({ extended : true }));

  // create http server and run it
  http.createServer(app).listen(port, () => {
    console.log(`Express server running on port ${port}...`)
  });

  // Home page route
  app.get('/', (req, res) => {
    console.log("Get request to home page");
    res.sendFile(__dirname + '/public/home.html');
  });

  // post scrape route
  app.post('/scrape', async (req, res) => {
    let data = req.body;
    console.log("Recieved scrape request from user.");
    console.log(`Video url: ${data.url}`);
    console.log(`Publish date: ${data.publishDate}`);
    console.log(`Video description: ${data.description}`);
    console.log(`Comments: ${data.comments}`); 

    // start scraping
    let videoData = await scrapeYoutubeVideo(data.url);

    // send scraped data back to client
    console.log(`Sending scraped data back to client.`)
    res.status(201);
    res.json(videoData)
    //res.json({"message" : "Post request success!"});

  });

};

main();
///////////////////////////////////////////////////////////////////////////////////////

async function scrapeYoutubeVideo(url) {

    // launch the browser
    const browser = await puppeteer.launch({headless: headlessBrowser, ignoreHTTPSErrors: true});
    // open a new page
    const page = await browser.newPage();
    // set the page size
    await page.setViewport({ width: 1280, height: 800 });

    // navigate to website link
    const youtube_video_url = url;
    console.log(`Navigating to ${youtube_video_url}...`);
    await page.goto(youtube_video_url, {waitUntil: 'domcontentloaded'});
  
    // get the video title
    await page.waitForSelector('#title h1', {visible: true}); //('#title h1', {timeout : 30_000})
    let title = await page.$eval('#title h1', el =>  el.innerText);
    console.log(`Video Title: ${title}`);

    // get channel name
    await page.waitForSelector('#upload-info #channel-name #container #text-container #text');
    let channelName = await page.$eval('#upload-info #channel-name #container #text-container #text', el => el.innerText);
    console.log(`Channel Name: ${channelName}`);

    // get the video description metadata
    await page.waitForSelector('tp-yt-paper-button#expand'); //, {visible: true});
    await page.click('tp-yt-paper-button#expand');
    
    // get video publish date
    await page.waitForSelector('#description-inner #info-container #info', {visible: true});
    let publishDate = await page.$eval('#description-inner #info-container #info', el => {
        return el.firstChild.nextSibling.nextSibling.innerText;         
    }); 
    console.log(`Video Publish Date: ${publishDate}`);

    await page.waitForSelector('#description-inner ytd-text-inline-expander yt-formatted-string', {visible: true})
    let description = await page.$eval('#description-inner ytd-text-inline-expander yt-formatted-string', el => {
      let des = "";
      for (item of el.childNodes) {
        if(item.innerText !== "" || item.innerText !== " ") des += item.innerText;
      }
      return des;
    });
    console.log(`Video Description:\n${description}`);
    //sleep(5000); // wait for 5 seconds
    
    // scroll down the page a couple of times
    let scrollCount = 0
    scrollCount = await scrollPage(page, 5, scrollCount, 2000);

    // get the total number of comments
    await page.waitForSelector('ytd-comments-header-renderer #title #count .count-text');// , {visible: true});
    let totalComments = await page.$eval('ytd-comments-header-renderer #title #count .count-text', el => {
      return el.firstChild.innerText; 
    });
    totalComments = totalComments.replace(",","");  
    console.log(`Total Number of Comments: ${totalComments}`);

    // scroll down the page some more
    scrollCount = await scrollPage(page, 5, scrollCount, 2000);
    // scroll back up
    let tempCount = scrollCount
    scrollCount = await scrollPage(page, -scrollCount+5, scrollCount, 0);
    scrollCount = tempCount+5;

    // get some comments
    console.log("Scraping all the comments...");
    let comments = await scrapeComments(page);
    console.log(`Number of comments found: ${comments.length}`);
    // console.log(comments);
    sleep(2000); // wait for 2 seconds 

    // if we haven't gotten all the comments yet, then scroll some more and get the remaining comments
    // NOTE: Banned/hidden youtube comments usually contribute to the total comments count, but they
    // don't show up, so the total count is almost always an overstimate of how many actual comments are in view 
    let commentsFound = comments.length-1; // decreased by one to allow the loop to run
    //console.log(comments.length, totalComments, commentsFound, comments.length);
    //console.log((comments.length < totalComments) && (commentsFound < comments.length));
    while (comments.length < totalComments) {
      
      // estimate how much we need to scroll to get all the comments
      let needToScroll = Math.ceil((totalComments - comments.length) / totalComments) * scrollCount;   
      console.log('Re-Scraping all the comments...');
      console.log(`Estimated number of scrolls: ${needToScroll}`);

      // scroll only a small bit first to make sure that we're not at the end of the page
      scrollCount = await scrollPage(page, 0.1 * needToScroll, scrollCount, 2000);
      // scroll back up
      let tempCount = scrollCount
      scrollCount = await scrollPage(page, -scrollCount, scrollCount, 0);
      scrollCount = tempCount;
      comments = await scrapeComments(page);
      console.log(`Number of comments found: ${comments.length}`);
      if(comments.length === commentsFound) {
        console.log("We've reached the end of the comments section!");
        break;
      }

      scrollCount = await scrollPage(page, needToScroll, scrollCount, 2000);
      // scroll back up
      tempCount = scrollCount
      scrollCount = await scrollPage(page, -scrollCount, scrollCount, 0);
      scrollCount = tempCount;
      comments = await scrapeComments(page);
      commentsFound = comments.length;
      console.log(`Number of comments found: ${comments.length}`);
      sleep(2000); // wait for 2 seconds 
    }
    console.log("Comment scraping completed.");

    sleep(1000); // wait 1 second
    console.log(`Now scrolling back up..`);
    // scroll back to the top
    scrollCount = await scrollPage(page, -scrollCount, scrollCount, 0);
    sleep(2000); // wait 2 seconds 

    // close the page
    await page.close();
    //close the browser
    await browser.close();

    // save video data in file
    filename = "scraped_data.JSON"; //title + ".JSON";
    let videoData = {};
    videoData['title'] = title;
    videoData['channelName'] = channelName;
    videoData['publishDate'] = publishDate;
    videoData['description'] = description;
    videoData['comments'] = comments;
    
    // fs.writeFile(filename, JSON.stringify(videoData), err => {
    //   if(err) {
    //     console.error(`Failed to write data to file => ${err}`);
    //   }
    //   else {
    //     console.log("Video data succesfully written to file.");
    //   }
    // });

    console.log('Done scraping!')
    return videoData;
}


// a basic sleep function
function sleep(milliseconds) {
    const date = Date.now();
    let currentDate = null;
    do {
        currentDate = Date.now();
    } while (currentDate - date < milliseconds);
}

// this function scrolls the page 'n' times (n>0 for down, n<0 for up), delay between scrolls in ms
async function scrollPage(page, n, count, delay) {
    if(n === 0) return count;
    console.log(`Scrolling the page ${n} times..`);
    let sign = n / Math.abs(n);

    for(let i = 0; i < Math.abs(n); i++) {
        if (i > 0) clearLastLine();
        await page.evaluate(sign => {
          window.scrollBy(0, sign*window.innerHeight);
        }, sign);
        console.log(`Scroll# ${i}`);
        sleep(delay); // wait 
    }  
    console.log(`Scroll count = ${count+n}`);
    return Math.floor(count += n);
}

// this function will scrape all the comments loaded within the current view window
async function scrapeComments(page) {

    //get all the comments
    await page.waitForSelector('#comments #sections #contents'); // , {visible: true});
    let comments = await page.$$eval('#comments #sections #contents ytd-comment-thread-renderer', (links) => {
        links = links.map(el => {
            let author = "";
            if(el.querySelector('#comment #body #main #header #header-author #author-comment-badge').innerHTML !== ""){
              author = el.querySelector('#comment #body #main #header #header-author #author-comment-badge ytd-author-comment-badge-renderer #name #channel-name #container #text-container #text').innerText;
            }
            else {
              author = el.querySelector('#comment #body #main #header #header-author h3').innerText;
            }
            let commentedWhen = el.querySelector('#comment #body #main #header #header-author .published-time-text a').innerText;
            let commentLikes = el.querySelector('#comment #body #main #action-buttons #toolbar #vote-count-middle').innerText;
            let comment = el.querySelector('#comment #body #main #comment-content #expander #content #content-text').innerText;     
            let hasReplies = (el.querySelector('#replies').innerHTML !== "");
            if(hasReplies){
                el.querySelector('#replies #more-replies button').click();
                //await page.waitForSelector('#replies #expander #expander-contents #contents ytd-comment-renderer #body #main'); 
            }
            return {"author" : author, "commentedWhen": commentedWhen, "commentLikes" : commentLikes, "comment" : comment, "hasReplies" : hasReplies};
        }); 
        return links;
    });  

    sleep(5000); // wait 5 seconds 

    // check if any comment haves replies, then get the replies
    if(comments.filter(comment => comment.hasReplies === true).length > 0) {
        console.log(`Found ${comments.filter(comment => comment.hasReplies === true).length} comment(s) with replies!`);
       //await page.waitForSelector('#comments #sections #contents'); // to make sure all replies are loaded
        await page.waitForSelector('#comments #sections #contents ytd-comment-thread-renderer #replies #expander #expander-contents #contents ytd-comment-renderer #body #main', {timeout: 600000}); // to make sure all replies are loaded
        //await page.waitForSelector('#comments #sections #contents #contents ytd-comment-thread-renderer #replies #expander #expander-contents #contents ytd-comment-renderer #body #main'); // to make sure all replies are loaded
        //get all the comments and replies
        comments = await page.$$eval('#comments #sections #contents ytd-comment-thread-renderer', links => {
            links = links.map(el => {
                let author = "";
                if(el.querySelector('#comment #body #main #header #header-author #author-comment-badge').innerHTML !== ""){
                  author = el.querySelector('#comment #body #main #header #header-author #author-comment-badge ytd-author-comment-badge-renderer #name #channel-name #container #text-container #text').innerText;
                }
                else {
                  author = el.querySelector('#comment #body #main #header #header-author h3').innerText;
                }
                let commentedWhen = el.querySelector('#comment #body #main #header #header-author .published-time-text a').innerText;
                let commentLikes = el.querySelector('#comment #body #main #action-buttons #toolbar #vote-count-middle').innerText;
                let comment = el.querySelector('#comment #body #main #comment-content #expander #content #content-text').innerText;
                let hasReplies = (el.querySelector('#replies').innerHTML !== "");
                let replies = [];
                if(hasReplies){
                    // get all the replies
                    let allReplies = el.querySelectorAll('#replies #expander #expander-contents #contents ytd-comment-renderer #body #main');
                    for (reply of allReplies) {
                        // get reply author name 
                        let replyAuthor = "";
                        if(reply.querySelector('#header #header-author #author-comment-badge').innerHTML !== ""){
                          replyAuthor = reply.querySelector('#header #header-author #author-comment-badge ytd-author-comment-badge-renderer #name #channel-name #container #text-container #text').innerText;
                        }
                        else {
                          replyAuthor = reply.querySelector('#header #header-author h3').innerText;
                        }
                        // get reply date
                        let replyWhen = reply.querySelector('#header #header-author .published-time-text a').innerText;
                        let replyLikes = reply.querySelector('#action-buttons #toolbar #vote-count-middle').innerText;
                        // get reply comment
                        let replyComment = reply.querySelector('#comment-content #expander #content #content-text').innerText;
                        replies.push({"replyAuthor" : replyAuthor, "replyWhen" : replyWhen, "replyLikes" : replyLikes, "replyComment" : replyComment}) ;
                    }
                }
                     
                return {"author" : author, "commentedWhen": commentedWhen, "commentLikes" : commentLikes, "comment" : comment, "hasReplies" : hasReplies, "replies" : replies};
            }); 
            return links;
        });  
    }

    let commentReplyArray = comments.filter(comment => comment.hasReplies === true);
    for (comment of commentReplyArray) {
        console.log("Replies: ");
        for (reply of comment.replies) {
          console.log(`${reply.replyAuthor}, ${reply.replyWhen}, ${reply.replyLikes}, ${reply.replyComment}`);
        }
    }

    return comments; 
}


const clearLastLine = () => {
    process.stdout.moveCursor(0, -1) // up one line
    process.stdout.clearLine(1) // from cursor to end
}
