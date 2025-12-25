import requests
import re

def get_facebook_token(cookie_string):
    # फेसबुक बिजनेस एडमिन पेज का URL जहाँ से टोकन मिलता है
    url = "https://business.facebook.com/business_locations"
    
    headers = {
        'cookie': cookie_string,
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
        'referer': 'https://www.facebook.com/',
        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8'
    }

    try:
        response = requests.get(url, headers=headers)
        
        # 'EAAG' से शुरू होने वाले टोकन को खोजने के लिए Regex
        token_match = re.search(r'(EAAG\w+)', response.text)
        
        if token_match:
            return token_match.group(1)
        else:
            return "टोकन नहीं मिला। कृपया अपनी कुकीज़ की जांच करें या फिर से लॉग-इन करें।"
            
    except Exception as e:
        return f"Error: {str(e)}"

# अपनी फेसबुक कुकी यहाँ पेस्ट करें
user_cookie"vpd=v1%3B858x508x2.125; fbl_st=101336624%3BT%3A29424650; xs=10%3AgGMxshdFdlc0sQ%3A2%3A1765478997%3A-1%3A-1; fr=0qSyqzy8sNfsLYqWb.AWdkRQal0MgMRV66KgCc7XQc9FCZ4XxxOVriwD2aHHk35_3MQRg.BpOxI-..AAA.0.0.BpTP0N.AWfBOPMZlhxlThFvzRIfz5L2adQ; pas=100023904154666%3ArgvLL8BMZ8; c_user=100023904154666; ps_n=1; sb=PhI7ab5ddVHD-YPjvKOdqAFS; wd=509x1130; wl_cbv=v2%3Bclient_version%3A3015%3Btimestamp%3A1765479021; ps_l=1; locale=en_GB; m_pixel_ratio=2.125; datr=PhI7aR6G7cQ3gqA6kk5_IL9L;

token = get_facebook_token(user_cookie)
print("आपका फेसबुक एक्सेस टोकन है:")
print(token)
