<?php

// Put into an Adminer that an app's Data tab gave a database (adminer_login_put): it opens on
// the database DATABASE_URL names, logged in as its own user, for a visitor signed in through
// the app's wall. serviceman says who that is in X-Auth-User, and drops any a visitor sends,
// so its being there means the wall let the visitor in. Without a wall nobody is
// let in, and a server typed in its form is never reached: every login is this database's.
class ServicemanDatabase extends Adminer\Plugin
{
    private $auth;

    function __construct()
    {
        $url = parse_url((string) getenv('DATABASE_URL'));
        $drivers = array('mysql' => 'server', 'mariadb' => 'server', 'postgresql' => 'pgsql', 'postgres' => 'pgsql');
        $this->auth = array(
            'driver' => $drivers[$url['scheme'] ?? ''] ?? 'server',
            'server' => ($url['host'] ?? '') . (isset($url['port']) ? ':' . $url['port'] : ''),
            'username' => rawurldecode($url['user'] ?? ''),
            'password' => rawurldecode($url['pass'] ?? ''),
            'db' => ltrim($url['path'] ?? '', '/'),
        );
        // The first visit logs in at once, the way the login form would
        if ($this->signed_in() && !isset($_GET['username']) && !$_POST) {
            $_POST['auth'] = $this->auth;
        }
    }

    function credentials()
    {
        return array($this->auth['server'], $this->auth['username'], $this->auth['password']);
    }

    function login($login, $password)
    {
        if (!$this->signed_in()) {
            return 'This Adminer opens only behind a wall: pick one in its Settings on serviceman\'s Apps.';
        }
        return true;
    }

    // Its login is made here, not posted by a page that could carry a token
    function verifyLoginToken()
    {
        return false;
    }

    private function signed_in()
    {
        return (($_SERVER['HTTP_X_AUTH_USER'] ?? '') !== '') && ($this->auth['username'] !== '');
    }
}

return new ServicemanDatabase();
