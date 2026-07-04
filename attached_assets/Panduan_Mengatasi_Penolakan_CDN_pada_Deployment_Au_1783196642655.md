# Panduan Mengatasi Penolakan CDN pada Deployment Autoscale

Dalam arsitektur modern, penggunaan Content Delivery Network (CDN) dan autoscaling adalah praktik umum untuk meningkatkan kinerja, ketersediaan, dan skalabilitas aplikasi. Namun, terkadang kombinasi keduanya dapat menimbulkan tantangan, salah satunya adalah penolakan CDN (CDN rejection) saat mencoba terhubung ke server origin yang diatur dengan autoscaling. Panduan ini akan membahas penyebab umum dan solusi teknis untuk mengatasi masalah tersebut.

## Pendahuluan

CDN berfungsi sebagai perantara antara pengguna dan server origin Anda, menyimpan salinan konten statis dan dinamis di lokasi geografis yang lebih dekat dengan pengguna. Autoscaling, di sisi lain, secara otomatis menyesuaikan kapasitas komputasi (misalnya, jumlah instance server) berdasarkan permintaan lalu lintas. Ketika CDN tidak dapat terhubung atau memvalidasi server origin yang di-autoscaling, hal ini dapat menyebabkan penolakan permintaan, menghasilkan error seperti `5xx` (misalnya, `521 Web Server Is Down` atau `522 Connection Timed Out`) kepada pengguna [2].

## Penyebab Umum Penolakan CDN

Beberapa faktor dapat menyebabkan CDN menolak koneksi ke origin yang di-autoscaling:

### 1. Kapasitas Origin Tidak Cukup atau Tidak Stabil

Meskipun autoscaling dirancang untuk menyesuaikan kapasitas, ada kalanya proses scaling tidak cukup cepat atau gagal menyediakan instance yang diperlukan. Ini dapat terjadi karena:

*   **`InsufficientInstanceCapacity` atau `UnfulfillableCapacity`**: Tidak ada cukup tipe instance yang tersedia di Availability Zone yang relevan untuk memenuhi permintaan scaling [1].
*   **Konfigurasi Auto Scaling yang Tidak Optimal**: Kebijakan scaling yang terlalu agresif atau terlalu lambat, atau batasan minimum/maksimum instance yang tidak sesuai dengan kebutuhan aplikasi.

### 2. Masalah Koneksi Origin

CDN memerlukan koneksi yang stabil dan dapat diandalkan ke server origin. Masalah koneksi dapat muncul karena:

*   **Error 522 (Connection Timed Out)**: Ini sering terjadi ketika Cloudflare (atau CDN lain) tidak dapat membuat koneksi TCP ke server web origin. Ini bisa disebabkan oleh firewall yang memblokir koneksi, server origin yang *offline*, atau masalah routing jaringan [2].
*   **Load Balancer Tidak Aktif atau Tidak Sehat**: Jika origin di belakang Load Balancer, Load Balancer mungkin tidak dalam status `Active` atau gagal meneruskan lalu lintas karena masalah konfigurasi atau *health check* yang gagal [4].
*   **VPC atau Subnet yang Salah Konfigurasi**: Instance autoscaling atau Load Balancer mungkin berada di VPC atau subnet yang tidak dapat dijangkau oleh CDN atau layanan Load Balancer itu sendiri [4].

### 3. Konfigurasi Keamanan yang Ketat

Pengaturan keamanan yang terlalu ketat pada server origin atau Load Balancer dapat memblokir permintaan dari CDN:

*   **Firewall atau Security Group**: Aturan firewall atau *security group* yang tidak mengizinkan lalu lintas dari IP CDN atau Load Balancer [3].
*   **Pembatasan Akses Langsung**: Jika Load Balancer atau server origin tidak dikonfigurasi untuk hanya menerima lalu lintas dari CDN, upaya akses langsung dapat menyebabkan masalah atau kerentanan [3].

### 4. Health Check Gagal

Auto Scaling Group dan Load Balancer menggunakan *health check* untuk memantau kondisi instance. Jika instance gagal dalam *health check*, mereka dapat dihapus dari Target Group atau dianggap tidak sehat, yang dapat menyebabkan CDN tidak dapat menjangkau origin yang valid [4].

### 5. Masalah Sertifikat SSL/TLS

Komunikasi HTTPS antara CDN dan origin memerlukan sertifikat SSL/TLS yang valid. Masalah dapat terjadi jika:

*   Sertifikat kedaluwarsa atau tidak cocok dengan nama domain.
*   Konfigurasi SSL/TLS yang tidak konsisten antara CDN dan origin (misalnya, versi TLS yang tidak didukung) [2].

### 6. Konfigurasi DNS/CNAME

Kesalahan dalam konfigurasi DNS, terutama saat menggunakan CNAME Flattening, dapat mengarahkan CDN ke alamat IP yang salah atau tidak stabil, terutama dengan Load Balancer yang memiliki IP dinamis [2].

## Solusi Teknis

Berikut adalah langkah-langkah dan solusi yang dapat diterapkan untuk mengatasi penolakan CDN pada deployment autoscale:

### 1. Optimasi Konfigurasi Auto Scaling

Untuk memastikan kapasitas origin selalu tersedia dan stabil:

*   **Tentukan Lebih Banyak Tipe Instance**: Sertakan beberapa tipe instance dalam konfigurasi Auto Scaling Group Anda. Ini memberikan lebih banyak opsi bagi penyedia cloud untuk meluncurkan instance jika satu tipe tidak tersedia [1].
*   **Tingkatkan Rentang Tipe Instance**: Gunakan pemilihan instance berbasis atribut (misalnya, berdasarkan vCPU atau memori) untuk memperluas pilihan tipe instance yang tersedia [1].
*   **Tingkatkan Jumlah Availability Zones Aktif**: Sebarkan instance Anda di lebih banyak Availability Zones untuk meningkatkan ketersediaan tipe instance secara keseluruhan [1].
*   **Gunakan Capacity Rebalancing**: Aktifkan fitur ini untuk secara proaktif mengganti instance Spot yang berisiko tinggi interupsi dengan instance yang lebih stabil, mengurangi kemungkinan kegagalan peluncuran [1].

### 2. Konfigurasi Koneksi CDN-Origin yang Tepat

Pastikan CDN dapat terhubung dengan mulus ke origin Anda:

*   **Verifikasi Status Load Balancer**: Pastikan Load Balancer yang digunakan sebagai origin CDN berada dalam status `Active` dan berfungsi dengan baik [4].
*   **Periksa Konfigurasi Target Group dan Health Check**: Pastikan *health check* pada Load Balancer dan Auto Scaling Group dikonfigurasi dengan benar dan instance Anda lulus pemeriksaan kesehatan. Sesuaikan ambang batas *health check* jika perlu [4].
*   **Konfigurasi Jaringan (VPC/Subnet)**: Pastikan semua komponen (instance, Load Balancer) berada di VPC dan subnet yang benar, dan ada rute jaringan yang memungkinkan lalu lintas dari CDN mencapai Load Balancer, dan dari Load Balancer ke instance [4].

### 3. Pengamanan Akses ke Load Balancer (Contoh AWS CloudFront)

Untuk memastikan hanya CDN yang dapat mengakses Load Balancer Anda, terapkan langkah-langkah keamanan berikut [3]:

*   **Konfigurasi CloudFront untuk Menambahkan Custom HTTP Header**: Atur CloudFront untuk menyertakan *header* HTTP kustom (misalnya, `X-Custom-Header: random-value`) pada setiap permintaan yang dikirim ke origin. Pastikan nama dan nilai *header* ini dirahasiakan.
*   **Konfigurasi Application Load Balancer (ALB) untuk Memvalidasi Header**: Buat aturan di ALB yang hanya meneruskan permintaan ke Target Group Anda jika *header* kustom yang ditentukan ada. Untuk permintaan tanpa *header* tersebut, ALB dapat mengembalikan respons `403 Forbidden`.
*   **Gunakan HTTPS untuk Semua Permintaan Origin**: Konfigurasi CloudFront untuk selalu menggunakan HTTPS saat berkomunikasi dengan origin Anda. Ini melindungi *header* kustom dari penyadapan. Pastikan ALB Anda memiliki *listener* HTTPS dengan sertifikat SSL/TLS yang valid.
*   **Rotasi Header Secara Berkala**: Secara rutin ubah nama dan nilai *header* kustom untuk meningkatkan keamanan.
*   **Batasi Akses dengan AWS-managed Prefix List**: Konfigurasi *security group* ALB Anda untuk hanya menerima lalu lintas dari *prefix list* IP yang dikelola AWS untuk CloudFront. Ini memblokir lalu lintas yang tidak berasal dari CloudFront pada lapisan jaringan.

### 4. Penanganan Error Spesifik (Contoh Alibaba Cloud Auto Scaling)

Beberapa pesan error spesifik dari penyedia cloud dapat memberikan petunjuk langsung tentang masalahnya [4]:

*   **`DBInstanceIdentifier does not refer to an existing DB instance.`**: Verifikasi bahwa instance ApsaraDB RDS yang terpasang pada scaling group memang ada.
*   **`The current status of the load balancer xxxxx does not support this action.`**: Pastikan instance Server Load Balancer (SLB) dalam status `Active`.
*   **`The specified SecurityGroupId does not exist.`**: Perbarui konfigurasi scaling untuk mereferensikan *security group* yang valid.
*   **`The specified LoadBalancerId does not exist.`**: Verifikasi bahwa instance SLB yang terpasang pada scaling group memang ada.
*   **`The specified launch template set is not found.`**: Pastikan *launch template* yang terkait dengan scaling group ada dan valid.
*   **`The specified image does not exist.`**: Perbarui konfigurasi scaling untuk mereferensikan *image* yang ada dan dapat diakses.
*   **`The resource is out of stock in the specified zone.`**: Perbarui konfigurasi scaling atau scaling group untuk menggunakan tipe instance atau zona yang berbeda.

## Kesimpulan

Penolakan CDN pada deployment autoscale seringkali disebabkan oleh miskonfigurasi antara komponen CDN, Load Balancer, dan Auto Scaling Group, atau masalah kapasitas pada infrastruktur origin. Dengan memahami penyebab umum dan menerapkan solusi teknis yang tepat, seperti optimasi konfigurasi autoscaling, memastikan koneksi origin yang stabil, dan mengamankan akses ke Load Balancer, Anda dapat mengatasi masalah ini dan memastikan aplikasi Anda berjalan dengan optimal dan dapat diakses melalui CDN.

## Referensi

1.  [When I try to launch an instance in my Amazon Elastic Compute Cloud (Amazon EC2) Auto Scaling group, I get an “InsufficientInstanceCapacity” or “UnfulfillableCapacity” error.](https://repost.aws/knowledge-center/ec2-auto-scaling-launch-error-capacity)
2.  [Issue to connect CF to AWS Load Balancer Error 522](https://community.cloudflare.com/t/issue-to-connect-cf-to-aws-load-balancer-error-522/86712)
3.  [Restrict access to Application Load Balancers](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/restrict-access-to-load-balancer.html)
4.  [Auto Scaling:Troubleshoot scaling activity exceptions](https://www.alibabacloud.com/help/en/auto-scaling/user-guide/troubleshoot-scaling-activity-exceptions)
