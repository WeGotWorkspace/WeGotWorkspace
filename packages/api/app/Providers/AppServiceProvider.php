<?php

declare(strict_types=1);

namespace App\Providers;

use App\Events\EventDispatch;
use App\Events\NotifyListener;
use App\Models\OauthClient;
use App\Services\Mcp\ConsentIntent;
use App\Services\Mcp\McpOAuthSubscriber;
use App\Services\Mcp\McpRedirectUris;
use App\Services\Mcp\McpScopes;
use App\Services\Mcp\PassportKeyStore;
use App\Services\Notify\MinishlinkWebPushSender;
use App\Services\Notify\WebPushSender;
use App\Support\SqliteTextLobStatement;
use Illuminate\Database\Events\ConnectionEstablished;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\View;
use Illuminate\Support\ServiceProvider;
use Laravel\Passport\Events\AccessTokenCreated;
use Laravel\Passport\Events\RefreshTokenCreated;
use Laravel\Passport\Passport;

class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->singleton(EventDispatch::class, function ($app): EventDispatch {
            return new EventDispatch([
                $app->make(NotifyListener::class),
            ]);
        });
        $this->app->singleton(WebPushSender::class, MinishlinkWebPushSender::class);
    }

    public function boot(): void
    {
        Event::listen(ConnectionEstablished::class, function (ConnectionEstablished $event): void {
            if ($event->connectionName !== 'wgw') {
                return;
            }

            SqliteTextLobStatement::deferOn($event->connection);
        });

        JsonResource::withoutWrapping();

        Passport::useClientModel(OauthClient::class);
        Passport::$deviceCodeGrantEnabled = false;
        Passport::tokensCan(McpScopes::descriptions());
        Passport::tokensExpireIn(now()->addHour());
        Passport::refreshTokensExpireIn(now()->addDays(30));
        Passport::authorizationView('mcp.authorize');

        $this->app->make(PassportKeyStore::class)->ensure();

        $subscriber = $this->app->make(McpOAuthSubscriber::class);
        Event::listen(RefreshTokenCreated::class, $subscriber->handleRefreshTokenCreated(...));
        Event::listen(AccessTokenCreated::class, $subscriber->handleAccessTokenCreated(...));

        View::composer('mcp.authorize', function ($view): void {
            $data = $view->getData();
            $client = $data['client'] ?? null;
            $user = $data['user'] ?? null;
            $origin = '';
            $clientId = '';
            $clientName = '';
            if (is_object($client)) {
                $clientId = (string) ($client->id ?? '');
                $clientName = (string) ($client->name ?? '');
                $origin = (string) ($client->cimd_origin ?? '');
                if ($origin === '' && is_array($client->redirect_uris ?? null) && isset($client->redirect_uris[0])) {
                    $origin = McpRedirectUris::originOf((string) $client->redirect_uris[0]);
                }
            }
            $username = is_object($user) ? (string) ($user->username ?? '') : '';
            $scopes = $data['scopes'] ?? [];
            $view->with([
                'clientOrigin' => $origin !== '' ? $origin : $clientName,
                'clientName' => $clientName,
                'username' => $username,
                'intent' => $this->app->make(ConsentIntent::class)->issue($username, $clientId),
                'scopeCatalog' => McpScopes::descriptions(),
                'scopeGroups' => McpScopes::groupConsentScopes(is_iterable($scopes) ? $scopes : []),
            ]);
        });
    }
}
