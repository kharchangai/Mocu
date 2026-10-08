# SSH Extension for Mocu

This extension lets Mocu connect to a remote server over SSH and transfer files over SFTP.

The extension does not store server credentials in Mocu. Instead, Mocu reads the **names** of environment variables from its settings, and the actual values are loaded from a `.env` file on your computer.

## Setup

### 1. Install the extension

Install the SSH extension in Mocu as usual.

### 2. Enter the environment variable names in Mocu

Open the SSH extension settings in the Mocu user interface and fill in the following fields. Enter only the **variable names**, never the actual values.

| Mocu setting | What to enter | Example |
|---|---|---|
| SSH host environment variable name | The name of the variable that holds the server hostname or IP address | `SSH_HOST` |
| SSH username environment variable name | The name of the variable that holds the SSH username | `SSH_USERNAME` |
| SSH port | The SSH port on the server (a number, not a variable name). Default: `22` | `22` |
| SSH password environment variable name | The name of the variable that holds the SSH password. Used when no private key path is set | `SSH_PASSWORD` |
| SSH private key path | Optional. The full path to your private key file on this computer. If set, it is used instead of the password | `C:\Users\you\.ssh\id_ed25519` |
| SSH private key passphrase environment variable name | Optional. The name of the variable that holds the passphrase of the private key | `SSH_KEY_PASSPHRASE` |
| .env file path | The full path to the `.env` file you will create in the next step | `C:\path\to\.env` |

Use the same variable names in the `.env` file as you entered in Mocu. For example, if you entered `SSH_HOST` in the host field, the `.env` file must contain a line starting with `SSH_HOST=`.

### 3. Create the `.env` file

Create a plain text file at the path you entered in the **.env file path** field, and add the variables. Replace the example values with your own:

```env
SSH_HOST=192.168.1.10
SSH_USERNAME=your-username
SSH_PASSWORD=your-password
SSH_KEY_PASSPHRASE=your-key-passphrase
```

Notes:

- Include only the variables you actually use. For example, if you use a private key without a passphrase, you do not need `SSH_KEY_PASSPHRASE`.
- Do not put quotation marks around values unless the value itself needs them.
- Do not commit the `.env` file to Git or share it, because it contains secrets.
- If the variable names in Mocu and in `.env` do not match, the extension will report an error such as `Environment variable SSH_HOST was not found in the .env file or is empty.`

## Using a private key instead of a password

If you use key-based login:

1. Set **SSH private key path** in Mocu to the full path of your private key file.
2. Leave **SSH password environment variable name** empty or remove `SSH_PASSWORD` from the `.env` file.
3. If the key has a passphrase, set **SSH private key passphrase environment variable name** and add that variable to the `.env` file.

Do not paste the contents of the private key into Mocu or into the `.env` file.

## Commands

| Command | Purpose |
|---|---|
| `ssh` | Run a command on the configured server |
| `ssh_upload` | Upload a local file to the server over SFTP. Requires `localPath` and `remotePath` |
| `ssh_download` | Download a file from the server over SFTP. Requires `remotePath` and `localPath` |

Existing destination files are not overwritten unless `overwrite` is explicitly set to `true`.

## Troubleshooting

- **`Configuration SSH_HOST_ENV is missing`**: Fill in the matching setting in Mocu.
- **`Environment variable ... was not found in the .env file or is empty`**: Check that the variable name in the `.env` file matches the name entered in Mocu exactly, and that it has a value.
- **`SSH_PORT must be an integer between 1 and 65535`**: Enter a valid port number.
- **Wrong `.env` file is loaded**: Check the **.env file path** setting. If it is empty, the extension looks for a `.env` file in the extension folder.
