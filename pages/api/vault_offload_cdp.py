import json
from coinbase.rest import RESTClient

try:
    # Load and format credentials
    with open('cdp_api_key.json', 'r') as f:
        creds = json.load(f)

    # Convert escaped newlines into actual newlines for PEM formatting
    formatted_key = creds['privateKey'].replace('\\n', '\n')

    client = RESTClient(
        api_key=creds['apiKey'],
        private_key=formatted_key
    )

    print("[SPARKR VAULT] Initiating Offload...")
    response = client.send_crypto(
        to='GeeEmFreelancing@gmail.com',
        amount='500.00',
        currency='USDC',
        description='SPARKR Vault Discharge - LIVE'
    )

    print("[SPARKR VAULT] Offload Executed:")
    print(json.dumps(response, indent=2))

except Exception as e:
    print("[SPARKR VAULT] Offload Failed ❌")
    print(str(e))

input("\u2705 Press Enter to close...")
