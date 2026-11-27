BO DU LIEU HINH HOC TONG HOP DE THU PIPELINE

shapes-classification.zip: chon Phan loai hinh anh.
shapes-segmentation.zip: chon Phan doan ngu nghia.
Moi ZIP gom 180 anh train va 60 anh val, 128 x 128 pixel.
Cac hinh: circle, square, triangle. Segmentation co them background (ID 0).
Khong giai nen ZIP truoc khi tai len Stratus.

Goi y: MobileNet V3 Small hoac U-Net Small; 5 vong, lo 4, anh 128 px, 300 giay.
Sau huan luyen, trien khai model va dung try-circle.png / try-square.png / try-triangle.png de thu inference.
Day la anh tong hop de kiem tra luong xu ly, khong phai bo benchmark chat luong model.
Ba anh try-* duoc lay tu tap val, chi dung de kiem tra inference, khong phai test doc lap.
Nguon: scripts/create_image_examples.py. Seed 20261127. Khong su dung anh ben thu ba.
